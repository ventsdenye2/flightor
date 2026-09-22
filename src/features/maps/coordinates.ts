export interface MapPoint { id:string; name:string; latitude:number; longitude:number; countryCode:string; number?:number; kind?:string }
export function displayPoint(point:MapPoint,target:'WGS84'|'GCJ02') {
 const inputSystem='WGS84' as const
 // Country evidence is required: bounding boxes alone incorrectly shift Korea and other neighbors.
 if(target==='WGS84'||point.countryCode!=='CN'||point.longitude<72.004||point.longitude>137.8347||point.latitude<0.8293||point.latitude>55.8271)return{...point,inputSystem,displaySystem:target,converted:false}
 const x=point.longitude-105,y=point.latitude-35,pi=Math.PI
 let lat=-100+2*x+3*y+0.2*y*y+0.1*x*y+0.2*Math.sqrt(Math.abs(x))
 let lon=300+x+2*y+0.1*x*x+0.1*x*y+0.1*Math.sqrt(Math.abs(x))
 const common=(20*Math.sin(6*x*pi)+20*Math.sin(2*x*pi))*2/3
 lat+=common+(20*Math.sin(y*pi)+40*Math.sin(y/3*pi))*2/3+(160*Math.sin(y/12*pi)+320*Math.sin(y*pi/30))*2/3
 lon+=common+(20*Math.sin(x*pi)+40*Math.sin(x/3*pi))*2/3+(150*Math.sin(x/12*pi)+300*Math.sin(x/30*pi))*2/3
 const rad=point.latitude/180*pi,magic=1-0.00669342162296594323*Math.sin(rad)**2,root=Math.sqrt(magic)
 return{...point,latitude:point.latitude+lat*180/((6378245*(1-0.00669342162296594323))/(magic*root)*pi),
  longitude:point.longitude+lon*180/(6378245/root*Math.cos(rad)*pi),inputSystem,displaySystem:target,converted:true}
}
