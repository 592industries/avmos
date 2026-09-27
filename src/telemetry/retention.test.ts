import { describe, expect, it } from 'vitest'
import type { Env } from '../../worker'
import { expiry, hourBucket, retentionDays, safeMessage } from './retention'
import { aggregateTelemetry, cleanupRetention } from './maintenance'
import type { ActionTools } from 'deepspace/worker'

describe('telemetry retention helpers', () => {
  it('uses bounded defaults and exact UTC expiration buckets', () => {
    const env = { TELEMETRY_RAW_RETENTION_DAYS: '0', RETENTION_DELETE_BATCH_SIZE: '500' } as Env
    expect(retentionDays(env).observations).toBe(7)
    expect(expiry(7, new Date('2026-09-20T12:00:00.000Z'))).toEqual({
      expiresAt: '2026-09-27T12:00:00.000Z',
      expiresOn: '2026-09-27',
    })
    expect(hourBucket('2026-09-27T12:45:22.000Z')).toBe('2026-09-27T12:00:00.000Z')
  })

  it('redacts provider secrets from operational errors', () => {
    expect(safeMessage('api_key=abc token:xyz wallet=seed')).toBe(
      'api_key=[REDACTED] token=[REDACTED] wallet=[REDACTED]',
    )
  })

  it('drains enough bounded pages for a ten-host daily backlog and reports backlog', async () => {
    const statuses: Record<string,Record<string,unknown>> = {}; let observationDeletes = 0
    const tools = {
      get: async (_collection:string,id:string)=>({success:true,data:{record:{data:{cursorDate:id.endsWith(':telemetry-observations')?'2026-09-20':'2026-10-01'}}}}),
      deleteWhere: async (collection:string)=>{if(collection==='telemetry-observations')observationDeletes+=1;return {success:true,data:{deleted:500}}},
      query: async(collection:string)=>collection==='workspaces'
        ? {success:true,data:{records:[{recordId:'workspace-default',data:{}}],count:1}}
        : {success:true,data:{records:[],count:0}},
      create: async (collection:string,data:Record<string,unknown>,id?:string)=>{if(collection==='retention-status'&&id)statuses[id]=data;return {success:true,data:{recordId:id??'log'}}},
    } as unknown as ActionTools
    await cleanupRetention(tools,{RETENTION_DELETE_BATCH_SIZE:'500'} as Env,new Date('2026-09-27T12:00:00.000Z'))
    expect(observationDeletes).toBe(12)
    expect(statuses['workspace-default:telemetry-observations']).toMatchObject({deleted:6000,status:'BACKLOG'})
  })

  it('aggregates a fleet hour without truncating at the global 500-row query limit', async () => {
    const aggregates:Record<string,unknown>[]=[]
    const tools={
      query:async(collection:string,options:{where?:Record<string,string>})=>collection==='resources'
        ? {success:true,data:{records:[{recordId:'server-1',data:{workspaceId:'workspace-default'}},{recordId:'server-2',data:{workspaceId:'workspace-default'}}]}}
        : {success:true,data:{records:Array.from({length:60},(_,index)=>({recordId:`obs-${index}`,data:{workspaceId:'workspace-default',resourceId:options.where?.resourceId,metric:options.where?.metric,unit:'percent',value:index,status:'LIVE'}}))}},
      create:async(collection:string,data:Record<string,unknown>)=>{if(collection==='telemetry-aggregates')aggregates.push(data);return {success:true,data:{recordId:'created'}}},
    } as unknown as ActionTools
    await aggregateTelemetry(tools,{} as Env,new Date('2026-09-27T13:15:00.000Z'))
    expect(aggregates).toHaveLength(10)
    expect(aggregates.every((row)=>row.sampleCount===60)).toBe(true)
  })
})
