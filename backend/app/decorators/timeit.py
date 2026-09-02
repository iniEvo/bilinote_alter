import time
import functools

def timeit(func):
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        start = time.perf_counter()
        result = func(*args, **kwargs)
        end = time.perf_counter()
        duration = end - start
        # 用 logger 代替 print，避免 stdout BrokenPipeError
        # 需延迟导入避免模块加载顺序问题
        from app.utils.logger import get_logger
        get_logger(func.__module__).info(f"{func.__name__} executed in {duration:.4f} seconds")
        return result
    return wrapper
