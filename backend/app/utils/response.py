import math
from fastapi.responses import JSONResponse
from app.utils.status_code import StatusCode
from pydantic import BaseModel
from typing import Optional, Any


def _sanitize_nan(obj: Any) -> Any:
    """递归清洗 JSON 不兼容的 float 值（NaN / Inf / -Inf）。

    常见于 faster-whisper 的 avg_logprob、numpy/pandas 统计字段等。
    递归修改 dict / list，float 就地替换为 None，返回清洗后的原对象。
    """
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    if isinstance(obj, dict):
        for k, v in obj.items():
            obj[k] = _sanitize_nan(v)
        return obj
    if isinstance(obj, list):
        for i, v in enumerate(obj):
            obj[i] = _sanitize_nan(v)
        return obj
    if isinstance(obj, tuple):
        return [_sanitize_nan(v) for v in obj]
    # pydantic model 转 dict 后再清洗
    if isinstance(obj, BaseModel):
        return _sanitize_nan(obj.model_dump())
    return obj


class ResponseWrapper:
    @staticmethod
    def success(data=None, msg="success", code=0):
        return JSONResponse(content={
            "code": code,
            "msg": msg,
            "data": _sanitize_nan(data),
        })

    @staticmethod
    def error(msg="error", code=500, data=None):
        return JSONResponse(content={
            "code": code,
            "msg": str(msg),
            "data": _sanitize_nan(data),
        })


# 兼容旧 import
R = ResponseWrapper
