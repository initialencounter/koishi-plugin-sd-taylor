import { Context, Schema, segment, Dict } from 'koishi'

export const name = 'sd-taylor'

const headers: object = {
  "headers": { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64); AppleWebKit/537.36 (KHTML, like Gecko); Chrome/54.0.2840.99 Safari/537.36" }
}

export interface Config {
  api_path: string
  cmd: string
  step: number
  denoising_strength: number
  seed: number
  maxConcurrency: number
  negative_prompt: string
  defaut_prompt: string
  resolution: string
  cfg_scale: number

}

export const Config: Schema<Config> = Schema.object({
  api_path: Schema.string().description('服务器地址').required(),
  cmd: Schema.string().default('tl').description('触发词'),
  step: Schema.number().default(20).description('采样步数0-100'),
  denoising_strength: Schema.number().default(0.5).description('改变强度0-1'),
  seed: Schema.number().default(-1).description('种子'),
  maxConcurrency: Schema.number().default(3).description('最大排队数'),
  negative_prompt: Schema.string().description('反向提示词').default('nsfw, lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry'),
  defaut_prompt: Schema.string().default('masterpiece, best quality').description('默认提示词'),
  resolution: Schema.string().default('720x512').description('默认比例'),
  cfg_scale: Schema.number().default(15).description('相关性0-20'),

})

export function isChinese(s) {
  return /[\u4e00-\u9fa5]/.test(s);
}

export function findInfo(s,ss) {
  const id1: number = s.indexOf(ss+': ')
  const sss: string = s.slice(id1,-1)
  const id3: number = sss.indexOf(',')
  const id2: number = sss.indexOf(' ')
  const res: string = sss.slice(id2+1,id3)
  return res

}
export function prompt_parse(s) {
  if (s.indexOf('<image file="') != -1) {
    const id1: number = s.indexOf('<image file="')
    const id2: number = s.indexOf('"/>')
    const imgstr: string = s.slice(id1,id2+3)
    const res:string = s.replace(imgstr,'')
    // console.log(s,id1,id2,imgstr)
    return res
  }
  return s
}
export function apply(ctx: Context, config: Config) {
  ctx.i18n.define('zh', require('./locales/zh'))


  const tasks: Dict<Set<string>> = Object.create(null)
  const globalTasks = new Set<string>()


  ctx.command('taylor <prompt:text>')
    .alias(config.cmd)
    .option('step', '--st <step:number>', { fallback: config.step })
    .option('denoising_strength', '-d <denoising_strength:number>', { fallback: config.denoising_strength })
    .option('seed', '--sd <seed:number>', { fallback: config.seed })
    .option('negative_prompt', '-n <negative_prompt:string>', { fallback: config.negative_prompt })
    .option('resolution', '-r <resolution:string>', { fallback: config.resolution })
    .option('cfg_scale', '-c <cfg_scale:number>', { fallback: config.cfg_scale })
    .action(async ({ session, options },prompt) => {
      if (!prompt?.trim()){
        return session.text('.no-args')
      } 
      const prompt_text: string = prompt_parse(prompt)
      // console.log(prompt_text)
      const id = Math.random().toString(36).slice(2)
      if (config.maxConcurrency) {
        const store = tasks[session.cid] ||= new Set()
        if (store.size >= config.maxConcurrency) {
          return session.text('.concurrent-jobs')
        } else {
          store.add(id)
        }
      }
      if(options.step>100){
        return session.text('.bad-step')
      }
      globalTasks.add(id)
      const cleanUp = () => {
        tasks[session.cid]?.delete(id)
        globalTasks.delete(id)
      }
      var api: string
      var img_url: string
      const [width, height]: number[] = options.resolution.split('x').map(Number)

      const attrs: Dict<any, string> = {
        userId: session.userId,
        nickname: session.author?.nickname || session.username,
      }
      // 设置参数
      const payload: object = {
        "steps": options.step,
        "width": width,
        "height": height,
        "seed": options.seed,
        "cfg_scale": options.cfg_scale,
        "negative_prompt": options.negative_prompt,
        "denoising_strength": options.denoising_strength,
        "prompt": prompt_text + ', ' + config.defaut_prompt
      }
      //判断api
      if (session.content.indexOf('<image file="') == -1) {
        if (isChinese(prompt_text)) {
          return session.text('.latin-only')
        }
        api = '/sdapi/v1/txt2img'
        payload["negative_prompt"] = options.negative_prompt

        session.send(session.text('.waiting') + '\n\n' + session.text('.args', [prompt_text, width, height, options.step, options.seed, options.cfg_scale]))
        // 调用sdweb-ui的api
        // console.log(`${config.api_path}${api}`)
        var resp = await ctx.http.post(`${config.api_path}${api}`, payload, headers)
        
        cleanUp()
        return `种子:${findInfo(resp.info,'Seed')}`+segment.image('base64://' + resp.images[0].replace(/^data:image\/[\w-]+;base64,/, ''))
      } else {
        
        // url提取拼接
        var regexp = /url="[^,]+"/;
        img_url = session.content.match(regexp)[0].slice(5, -1)
        // 将图片url转化成base64数据
        const buffer = await ctx.http.get(img_url, { responseType: 'arraybuffer', headers })
        const base64 = Buffer.from(buffer).toString('base64')
        if (!prompt) {
          var resp3 = await ctx.http.post(`${config.api_path}/sdapi/v1/interrogate`, { "image": "data:image/png;base64," + base64 })
          cleanUp()
          return segment.image('base64://' + base64) + '图片信息:\n' + resp3.caption
        } else {
          api = '/sdapi/v1/img2img'

          // 设置payload
          payload["init_images"] = ["data:image/png;base64," + base64]
          session.send(session.text('.waiting') + '\n\n' + session.text('.args', [prompt_text, width, height, options.step, options.seed, options.cfg_scale]))
          var resp2 = await ctx.http.post(`${config.api_path}${api}`, payload, headers)
          cleanUp()
          return '原图:' + segment.image('base64://' + base64) + `种子:${findInfo(resp2.info,'Seed')}\n\n结果:` + segment.image('base64://' + resp2.images[0].replace(/^data:image\/[\w-]+;base64,/, ''))
        }
      }

    })
}

