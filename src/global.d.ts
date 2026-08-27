// src/global.d.ts — 编译期注入的全局常量声明
/** OpenRouter 密钥（config/index.js 构建时从 openrouter.txt 注入；缺失为空串） */
declare const OPENROUTER_KEY: string
/** SerpApi 密钥（构建时从 serpapi.txt 注入；缺失为空串，搜索回退 mock/云函数） */
declare const SERPAPI_KEY: string
