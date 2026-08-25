# exceptions/biz_exception.py

class BizException(Exception):
    def __init__(self, code: int, message: str = "业务异常"):
        super().__init__(message)
        self.code = code
        self.message = message
        self.detail = message

    def __str__(self) -> str:
        return self.message