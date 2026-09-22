// Production H5 build with the same source metadata as the WeChat build.
const path=require('node:path'),{spawnSync}=require('node:child_process')
const {createBuildInfo,buildEnvironment,writeBuildInfo}=require('./weapp-build-info.cjs')
const root=path.resolve(__dirname,'..'),info=createBuildInfo(root,'production-h5',process.env.FLIGHTOR_API_BASE_URL||'http://127.0.0.1:3000')
const result=spawnSync(process.execPath,[path.join(root,'node_modules/@tarojs/cli/bin/taro'),'build','--type','h5'],{cwd:root,stdio:'inherit',env:{...process.env,...buildEnvironment(info)}})
if(result.error)throw result.error
if(result.status===0)writeBuildInfo(root,info,'dist-h5')
process.exitCode=result.status??1
