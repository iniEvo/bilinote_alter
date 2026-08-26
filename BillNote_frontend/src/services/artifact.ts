import request from '@/utils/request'

export interface ArtifactInfo {
  key: string
  name: string
  description: string
  /** 生成物所在目录（可能多个，如抽帧产物） */
  paths: string[]
  file_count: number
  size_bytes: number
  deletable: boolean
  warning: string | null
}

export interface CleanupResult {
  key: string
  status: 'done' | 'refused'
  removed_files?: number
  freed_bytes?: number
  msg: string
}

export const getArtifacts = async (): Promise<{ artifacts: ArtifactInfo[] }> => {
  return await request.get('/artifacts')
}

export const cleanupArtifacts = async (keys: string[]): Promise<{ results: CleanupResult[] }> => {
  return await request.post('/artifacts/cleanup', { keys })
}
