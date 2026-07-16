import json
import time
import httpx
from typing import Generator

from config.settings import DEFAULT_BASE_URL, DEFAULT_MODEL, QWEN_BASE_URL, QWEN_MODEL, API_TIMEOUT, MAX_TOKENS
from prompts.testcase_prompt import SYSTEM_PROMPT, USER_MESSAGE_TEMPLATE
from utils.logger import setup_logging

log = setup_logging("ai")

# 超时配置：connect/read/write/pool
_API_TIMEOUT = httpx.Timeout(connect=30.0, read=float(API_TIMEOUT), write=30.0, pool=10.0)
_STREAM_TIMEOUT = httpx.Timeout(connect=30.0, read=300.0, write=30.0, pool=10.0)
_MAX_RETRIES = 2
_RETRY_BACKOFF = 1.5  # 秒，指数增长


class AIClient:
    """DeepSeek API 客户端（Anthropic Messages 格式 + 思考模式）"""

    def __init__(self, api_key: str, base_url: str = "", model: str = ""):
        self._api_key = api_key
        self._base_url = (base_url or DEFAULT_BASE_URL).rstrip("/")
        self._model = model or DEFAULT_MODEL

    def _call_api(self, messages: list, system_prompt: str = "") -> dict:
        api_url = self._base_url + "/v1/messages"
        headers = {
            "x-api-key": self._api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        body = {
            "model": self._model,
            "max_tokens": MAX_TOKENS,
            "thinking": {"type": "enabled", "budget_tokens": 2048},
            "messages": messages,
        }
        if system_prompt:
            body["system"] = system_prompt

        last_err = None
        for attempt in range(_MAX_RETRIES + 1):
            try:
                log.info("Call %s model=%s msgs=%d (attempt %d)", api_url, self._model, len(messages), attempt + 1)
                resp = httpx.post(api_url, headers=headers, json=body, timeout=_API_TIMEOUT, verify=False)
                if resp.is_success:
                    data = resp.json()
                    blocks = data.get("content", [])
                    result = self._parse_blocks(blocks)
                    result["usage"] = data.get("usage", {})
                    return result
                # 4xx 不重试
                if 400 <= resp.status_code < 500:
                    log.error("API client error %s: %s", resp.status_code, resp.text[:500])
                    raise RuntimeError(f"API 请求失败 ({resp.status_code}): {resp.text[:300]}")
                # 5xx 可重试
                log.warning("API server error %s (attempt %d/%d)", resp.status_code, attempt + 1, _MAX_RETRIES + 1)
                last_err = RuntimeError(f"API 请求失败 ({resp.status_code}): {resp.text[:300]}")
            except (httpx.ConnectError, httpx.ReadError, httpx.RemoteProtocolError) as e:
                log.warning("Network error (attempt %d/%d): %s", attempt + 1, _MAX_RETRIES + 1, e)
                last_err = e
            if attempt < _MAX_RETRIES:
                time.sleep(_RETRY_BACKOFF ** (attempt + 1))
        raise last_err

    def _parse_blocks(self, blocks: list) -> dict:
        text_parts = []
        thinking_parts = []
        for b in blocks:
            t = b.get("type", "")
            if t == "text":
                text_parts.append(b.get("text", ""))
            elif t == "thinking":
                thinking_parts.append(b.get("thinking", ""))
            elif t == "redacted_thinking":
                thinking_parts.append("[redacted]")
        return {
            "content": "\n".join(text_parts),
            "reasoning": "\n".join(thinking_parts) if thinking_parts else None,
        }

    def _stream_api(self, messages: list, system_prompt: str = "") -> Generator[dict, None, None]:
        api_url = self._base_url + "/v1/messages"
        headers = {
            "x-api-key": self._api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        body = {
            "model": self._model,
            "max_tokens": MAX_TOKENS,
            "thinking": {"type": "enabled", "budget_tokens": 2048},
            "messages": messages,
            "stream": True,
        }
        if system_prompt:
            body["system"] = system_prompt

        # 连接级别重试（流式连接失败时重试，一旦开始推流就不再重试）
        last_err = None
        for attempt in range(_MAX_RETRIES + 1):
            try:
                log.info("Stream call %s model=%s msgs=%d (attempt %d)", api_url, self._model, len(messages), attempt + 1)
                with httpx.stream("POST", api_url, headers=headers, json=body, timeout=_STREAM_TIMEOUT, verify=False) as resp:
                    if not resp.is_success:
                        if 400 <= resp.status_code < 500:
                            log.error("Stream client error %s: %s", resp.status_code, resp.text[:500])
                            yield {"type": "error", "message": f"API 请求失败 ({resp.status_code}): {resp.text[:200]}"}
                            return
                        # 5xx — 可重试
                        log.warning("Stream server error %s (attempt %d/%d)", resp.status_code, attempt + 1, _MAX_RETRIES + 1)
                        last_err = RuntimeError(f"API 请求失败 ({resp.status_code})")
                        if attempt < _MAX_RETRIES:
                            time.sleep(_RETRY_BACKOFF ** (attempt + 1))
                            continue
                        yield {"type": "error", "message": str(last_err)}
                        return

                    # 连接成功，开始推流
                    for line in resp.iter_lines():
                        if not line or not line.startswith("data: "):
                            continue
                        data_str = line[6:]
                        if data_str == "[DONE]":
                            break
                        try:
                            event = json.loads(data_str)
                            yield self._parse_stream_event(event)
                        except json.JSONDecodeError:
                            log.debug("Stream JSON decode error: %s", data_str[:100])
                            continue
                    return  # 正常结束
            except (httpx.ConnectError, httpx.ReadError, httpx.RemoteProtocolError) as e:
                log.warning("Stream network error (attempt %d/%d): %s", attempt + 1, _MAX_RETRIES + 1, e)
                last_err = e
                if attempt < _MAX_RETRIES:
                    time.sleep(_RETRY_BACKOFF ** (attempt + 1))
                    continue
        yield {"type": "error", "message": f"连接失败: {last_err}"}

    def _parse_stream_event(self, event: dict) -> dict:
        t = event.get("type", "")
        if t == "content_block_start":
            block = event.get("content_block", {})
            return {"type": "block_start", "content_type": block.get("type", "")}
        elif t == "content_block_delta":
            delta = event.get("delta", {})
            dt = delta.get("type", "")
            if dt == "thinking_delta":
                return {"type": "thinking", "text": "", "thinking": delta.get("thinking", "")}
            elif dt == "text_delta":
                return {"type": "text", "text": delta.get("text", ""), "thinking": ""}
            return {"type": "delta", "content_type": dt, "text": delta.get("text", ""), "thinking": delta.get("thinking", "")}
        elif t == "message_delta":
            usage = event.get("usage", {})
            return {"type": "usage", "input_tokens": usage.get("input_tokens", 0),
                    "output_tokens": usage.get("output_tokens", 0)}
        elif t == "message_stop":
            return {"type": "done"}
        elif t == "error":
            return {"type": "error", "message": event.get("error", {}).get("message", "未知错误")}
        return {"type": "unknown"}

    def chat_raw(self, messages: list, system_prompt: str = "") -> dict:
        return self._call_api(messages, system_prompt)

    def generate_testcases(self, prd_text: str, system_prompt: str = "", user_template: str = "") -> dict:
        sp = system_prompt or SYSTEM_PROMPT
        ut = user_template or USER_MESSAGE_TEMPLATE
        return self._call_api(
            messages=[{"role": "user", "content": ut.format(prd_text=prd_text)}],
            system_prompt=sp,
        )

    def chat_stream(self, messages: list, system_prompt: str = "") -> Generator[dict, None, None]:
        return self._stream_api(messages, system_prompt)

    def generate_stream(self, prd_text: str, system_prompt: str = "", user_template: str = "") -> Generator[dict, None, None]:
        sp = system_prompt or SYSTEM_PROMPT
        ut = user_template or USER_MESSAGE_TEMPLATE
        return self._stream_api(
            messages=[{"role": "user", "content": ut.format(prd_text=prd_text)}],
            system_prompt=sp,
        )


# ── 千问多模态流式生成（OpenAI Chat Completions 格式，独立于 AIClient） ──

def qwen_multimodal_stream(
    api_key: str,
    base_url: str,
    model: str,
    content_parts: list,
    system_prompt: str = "",
    history: list | None = None,
    max_tokens: int = MAX_TOKENS,
) -> Generator[dict, None, None]:
    """千问 Qwen3.7-Plus 多模态流式生成。
    content_parts: OpenAI 格式的 content 数组，
      如 [{"type":"text","text":"..."}, {"type":"image_url","image_url":{"url":"data:..."}}]
    history: 历史消息列表 [{"role":"user","content":"..."}, {"role":"assistant","content":"..."}, ...]
    返回事件格式与 DeepSeek 流式一致：{type, text, thinking}，前端无需改动。
    """
    api_url = (base_url or QWEN_BASE_URL).rstrip("/") + "/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    # 插入历史对话，保持上下文连贯
    for h in (history or []):
        if isinstance(h, dict) and h.get("role") in ("user", "assistant") and h.get("content"):
            messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": content_parts})

    body = {
        "model": model or QWEN_MODEL,
        "messages": messages,
        "stream": True,
        "max_tokens": max_tokens,
        "enable_thinking": True,
    }

    last_err = None
    for attempt in range(_MAX_RETRIES + 1):
        try:
            log.info("Qwen multimodal call %s model=%s parts=%d (attempt %d)",
                     api_url, body["model"], len(content_parts), attempt + 1)
            with httpx.stream("POST", api_url, headers=headers, json=body,
                              timeout=_STREAM_TIMEOUT, verify=False) as resp:
                if not resp.is_success:
                    if 400 <= resp.status_code < 500:
                        log.error("Qwen client error %s: %s", resp.status_code, resp.text[:500])
                        yield {"type": "error", "message": f"API 请求失败 ({resp.status_code}): {resp.text[:200]}"}
                        return
                    log.warning("Qwen server error %s (attempt %d/%d)",
                                resp.status_code, attempt + 1, _MAX_RETRIES + 1)
                    last_err = RuntimeError(f"API 请求失败 ({resp.status_code})")
                    if attempt < _MAX_RETRIES:
                        time.sleep(_RETRY_BACKOFF ** (attempt + 1))
                        continue
                    yield {"type": "error", "message": str(last_err)}
                    return

                for line in resp.iter_lines():
                    if not line or not line.startswith("data: "):
                        continue
                    data_str = line[6:]
                    if data_str == "[DONE]":
                        break
                    try:
                        event = json.loads(data_str)
                        ev = _parse_qwen_stream_event(event)
                        if ev is not None:
                            yield ev
                    except json.JSONDecodeError:
                        log.debug("Qwen stream JSON error: %s", data_str[:100])
                        continue
                return
        except (httpx.ConnectError, httpx.ReadError, httpx.RemoteProtocolError) as e:
            log.warning("Qwen network error (attempt %d/%d): %s", attempt + 1, _MAX_RETRIES + 1, e)
            last_err = e
            if attempt < _MAX_RETRIES:
                time.sleep(_RETRY_BACKOFF ** (attempt + 1))
                continue
    yield {"type": "error", "message": f"连接失败: {last_err}"}


_SUMMARIZE_PROMPT = "你是会话命名助手。下面是一段 AI 生成测试用例时的思考过程，请根据思考过程中提到的功能模块和业务需求，提炼一个 15 字以内的简短会话标题。\n规则：\n1. 标题要概括本次 PRD 涉及的核心功能或业务，不是概括思考过程本身\n2. 直接输出标题，不要引号、标点、换行、前缀或任何解释\n3. 如果思考中提到了具体模块名（如'登录''支付''角色管理'），优先使用\n4. 严格不超过 15 个中文字"


def summarize_text(api_key: str, base_url: str, model: str, thinking: str) -> str:
    """用 AI 从思考过程中提取会话摘要（非流式、禁用思考模式）"""
    import httpx as _httpx

    api_url = (base_url or DEFAULT_BASE_URL).rstrip("/")

    # DeepSeek (Anthropic 格式)
    if "deepseek" in api_url.lower():
        resp = _httpx.post(
            api_url + "/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": model or DEFAULT_MODEL,
                "max_tokens": 64,
                "thinking": {"type": "disabled"},
                "system": _SUMMARIZE_PROMPT,
                "messages": [{"role": "user", "content": thinking[:2000]}],
            },
            timeout=_httpx.Timeout(connect=10.0, read=20.0, write=10.0, pool=5.0),
            verify=False,
        )
        if resp.is_success:
            data = resp.json()
            for block in data.get("content", []):
                if block.get("type") == "text":
                    return block.get("text", "").strip()[:30]
    else:
        # Qwen / OpenAI 兼容格式
        resp = _httpx.post(
            api_url + "/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model or QWEN_MODEL,
                "max_tokens": 64,
                "messages": [
                    {"role": "system", "content": _SUMMARIZE_PROMPT},
                    {"role": "user", "content": thinking[:2000]},
                ],
            },
            timeout=_httpx.Timeout(connect=10.0, read=20.0, write=10.0, pool=5.0),
            verify=False,
        )
        if resp.is_success:
            data = resp.json()
            choices = data.get("choices", [])
            if choices:
                return (choices[0].get("message", {}).get("content", "") or "").strip()[:30]

    log.warning("Summarize failed: status=%s", resp.status_code if resp else "none")
    return ""


def _parse_qwen_stream_event(event: dict) -> dict | None:
    """将 OpenAI chat.completions SSE chunk 转为统一事件格式"""
    choices = event.get("choices", [])
    if not choices:
        return None
    delta = choices[0].get("delta", {})
    # 思考内容
    reasoning = delta.get("reasoning_content") or ""
    # 正文内容
    content = delta.get("content") or ""
    finish = choices[0].get("finish_reason") or ""

    if reasoning and not content:
        return {"type": "thinking", "text": "", "thinking": reasoning}
    if content:
        result = {"type": "text", "text": content, "thinking": ""}
        if reasoning:
            result["thinking"] = reasoning
        return result
    if finish and finish != "stop":
        return {"type": "error", "message": f"生成异常终止: {finish}"}
    return None
