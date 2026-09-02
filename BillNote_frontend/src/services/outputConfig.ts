import request from '@/utils/request'

export interface OutputConfig {
  /** 用户配置的 Markdown 输出目录（空字符串表示使用默认目录） */
  markdown_output_dir: string
  /** 当前实际生效的 Markdown 落盘目录（绝对路径） */
  effective_markdown_dir: string
}

export const getOutputConfig = async (): Promise<OutputConfig> => {
  return await request.get('/output_config')
}

export const updateOutputConfig = async (markdownOutputDir: string): Promise<OutputConfig> => {
  return await request.post('/output_config', { markdown_output_dir: markdownOutputDir })
}