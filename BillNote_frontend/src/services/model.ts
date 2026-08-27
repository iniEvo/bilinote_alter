import request from '@/utils/request.ts'

// opts.silent: 让本次请求失败时不弹全局红 toast（调用方自行 catch 处理，
// 比如 onboarding 撞名重试这种预期内失败）
interface CallOpts { silent?: boolean }
const cfg = (o?: CallOpts) => (o?.silent ? { suppressToast: true } : undefined)

export const getProviderList = async (opts?: CallOpts) => {
  return await request.get('/get_all_providers', cfg(opts))
}
export const getProviderById = async (id: string) => {
  return await request.get(`/get_provider_by_id/${id}`)
}
export const updateProviderById = async (data: any, opts?: CallOpts) => {
  return await request.post('/update_provider', data, cfg(opts))
}

export const addProvider = async (data: any, opts?: CallOpts) => {
  return await request.post('/add_provider', data, cfg(opts))
}

export const deleteProviderById = async (id: string) => {
  return await request.post('/delete_provider', { id })
}

export const testConnection = async (data: any, opts?: CallOpts) => {
  // 连通性测试要等后端真实发一条 chat completion，慢网关（如实测的 infer ai）
  // 单次响应可达 13~15s，全局默认 10s 超时会在后端成功前掐断，
  // 误报「请求失败，请检查网络连接」，所以这里单独放宽到 60s。
  return await request.post('/connect_test', data, { ...cfg(opts), timeout: 60000 })
}

export const fetchModels = async (providerId: string) => {
  return await request.get('/model_list/' + providerId)
}

export const fetchEnableModelById = async (id: string) => {
  return await request.get('/model_enable/' + id)
}

export async function addModel(
  data: { provider_id: string; model_name: string },
  opts?: CallOpts,
) {
  return request.post('/models', data, cfg(opts))
}

export const fetchEnableModels = async () => {
  return await request.get('/model_list')
}

export const deleteModelById = async (modelId: number) => {
  return await request.get(`/models/delete/${modelId}`)
}