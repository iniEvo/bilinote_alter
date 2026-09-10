import request from '@/utils/request'

export interface SysHealth {
  backend: 'ok' | 'error'
  ffmpeg: 'ok' | 'missing'
  db: 'ok' | 'error'
  whisper_model: {
    /** 当前选中的模型 size，例如 'tiny' / 'base' / 'large-v3' */
    size: string | null
    /** 转写器类型 */
    type: string | null
    /** 是否已完整下载到本地（仅本地引擎有意义） */
    downloaded: boolean
    /** 是否实际检查过 —— 在线引擎跳过检查时为 false */
    checked: boolean
  }
}

/** 详细健康状态：用于设置页 / 启动诊断。后端始终返回 200，按字段判断各项。 */
export const getSysHealth = async (): Promise<SysHealth> => {
  return await request.get('/sys_health')
}

/** 保留旧 systemCheck 函数名（App.tsx 启动时仍调用），返回值同 getSysHealth。 */
export const systemCheck = getSysHealth

export interface DeployStatus {
  backend: {
    status: string
    port: number
  }
  cuda: {
    available: boolean
    /** torch 是否安装。轻量部署没装 torch 时为 false，避免误判为 CUDA 故障 */
    torch_installed?: boolean
    version: string | null
    gpu_name: string | null
  }
  whisper: {
    model_size: string
    transcriber_type: string
    /** 模型是否已完整下载（fast-whisper 看 model.bin / mlx 看 config.json） */
    downloaded: boolean
    /** 当前生效的模型目录 */
    model_dir?: string
  }
  ffmpeg: {
    available: boolean
    /** 当前生效的 ffmpeg 可执行文件路径 */
    executable?: string
  }
}

export const getDeployStatus = async (): Promise<DeployStatus> => {
  return await request.get('/deploy_status')
}

// ── 外部路径配置（FFmpeg / Whisper 模型目录）──────────────────────────

export interface BinPathsConfig {
  ffmpeg_path: string
  whisper_model_dir: string
  effective_ffmpeg: string
  effective_ffprobe: string
  effective_whisper_dir: string
}

export const getBinPathsConfig = async (): Promise<BinPathsConfig> => {
  return await request.get('/bin_paths_config')
}

export const saveBinPathsConfig = async (data: {
  ffmpeg_path?: string | null
  whisper_model_dir?: string | null
}): Promise<{ ffmpeg_path: string; whisper_model_dir: string }> => {
  return await request.post('/bin_paths_config', data)
}
