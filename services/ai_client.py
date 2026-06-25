import json
import httpx
from typing import Generator

from config.settings import DEFAULT_BASE_URL, DEFAULT_MODEL, API_TIMEOUT, MAX_TOKENS
from prompts.testcase_prompt import SYSTEM_PROMPT, USER_MESSAGE_TEMPLATE
from utils.logger import setup_logging

log = setup_logging("ai")


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

        log.info("Call %s model=%s msgs=%d", api_url, self._model, len(messages))
        resp = httpx.post(api_url, headers=headers, json=body, timeout=API_TIMEOUT)

        if not resp.is_success:
            log.error("API error %s: %s", resp.status_code, resp.text[:500])
            raise RuntimeError(f"API 请求失败 ({resp.status_code}): {resp.text[:300]}")

        data = resp.json()
        blocks = data.get("content", [])
        return self._parse_blocks(blocks)

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

        log.info("Stream call %s model=%s msgs=%d", api_url, self._model, len(messages))
        with httpx.stream("POST", api_url, headers=headers, json=body, timeout=API_TIMEOUT) as resp:
            if not resp.is_success:
                log.error("Stream error %s: %s", resp.status_code, resp.text[:500])
                yield {"type": "error", "message": f"API 请求失败 ({resp.status_code})"}
                return

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
                    continue

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
