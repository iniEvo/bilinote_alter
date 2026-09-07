import enum


class TaskStatus(str, enum.Enum):
    PENDING = "PENDING"
    PAUSED = "PAUSED"
    CANCELED = "CANCELED"
    PARSING = "PARSING"
    DOWNLOADING = "DOWNLOADING"
    TRANSCRIBING = "TRANSCRIBING"
    SUMMARIZING = "SUMMARIZING"
    FORMATTING = "FORMATTING"
    SAVING = "SAVING"
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"
    # 瞬时错误（连接中断/超时等）导致的失败，任务本身有效的，可直接重试
    RETRYABLE = "RETRYABLE"

    @classmethod
    def description(cls, status):
        desc_map = {
            cls.PENDING: "排队中",
            cls.PAUSED: "已暂停",
            cls.CANCELED: "已取消",
            cls.PARSING: "解析链接",
            cls.DOWNLOADING: "下载中",
            cls.TRANSCRIBING: "转录中",
            cls.SUMMARIZING: "总结中",
            cls.FORMATTING: "格式化中",
            cls.SAVING: "保存中",
            cls.SUCCESS: "完成",
            cls.FAILED: "失败",
            cls.RETRYABLE: "连接中断，可重试",
        }
        return desc_map.get(status, "未知状态")
