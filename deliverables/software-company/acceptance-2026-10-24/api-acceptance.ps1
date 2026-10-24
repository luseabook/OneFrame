$ErrorActionPreference = 'Continue'
$base = 'http://127.0.0.1:8080/v1'
$compose = 'docker-compose.prod.yml'

function ApiPost($url, $obj, $hdrs) {
  $body = if ($obj -is [string]) { $obj } else { $obj | ConvertTo-Json -Depth 12 -Compress }
  try { Invoke-RestMethod -Method Post -Uri $url -ContentType 'application/json' -Body $body -Headers $hdrs }
  catch { @{ code = 'EXC'; msg = $_.Exception.Message; raw = $_.ErrorDetails.Message } }
}
function ApiGet($url, $hdrs) {
  try { Invoke-RestMethod -Uri $url -Headers $hdrs } catch { @{ code = 'EXC'; msg = $_.Exception.Message; raw = $_.ErrorDetails.Message } }
}
function ApiDelete($url, $hdrs) {
  try { Invoke-RestMethod -Method Delete -Uri $url -Headers $hdrs } catch { @{ code = 'EXC'; msg = $_.Exception.Message; raw = $_.ErrorDetails.Message } }
}
function ApiPatch($url, $obj, $hdrs) {
  try { Invoke-RestMethod -Method Patch -Uri $url -ContentType 'application/json' -Body ($obj | ConvertTo-Json -Depth 8 -Compress) -Headers $hdrs }
  catch { @{ code = 'EXC'; msg = $_.Exception.Message; raw = $_.ErrorDetails.Message } }
}
function Login($phone) {
  $null = ApiPost "$base/auth/sms-code" (@{ phone = $phone }) @{}
  $raw = docker compose -f $compose exec -T redis redis-cli --raw get "sms:code:$phone" 2>&1
  $code = ($raw | ConvertFrom-Json).code
  $l = ApiPost "$base/auth/login" (@{ phone = $phone; code = $code; age_confirmed = $true }) @{}
  return @{ token = $l.data.access_token; space = $l.data.space_id; h = @{ Authorization = "Bearer $($l.data.access_token)" } }
}

$u = Login '13711110001'
$h = $u.h
Write-Output "SETUP space=$($u.space)"

Write-Output "`n--- B1 任务全流程 ---"
$q = ApiPost "$base/credits/quote" (@{ mode='text2video'; model='sky-media-2.0'; input=@{prompt='验收任务'}; options=@{ratio='9:16';resolution='720p';duration=5;count=1} }) $h
$g = ApiPost "$base/generations" (@{ mode='text2video'; model='sky-media-2.0'; input=@{prompt='验收任务'}; options=@{ratio='9:16';resolution='720p';duration=5;count=1}; quote_id=$q.data.quote_id }) ($h + @{ 'Idempotency-Key' = [guid]::NewGuid().ToString() })
$taskId = $g.data.task_id
Write-Output "create code=$($g.code) task=$taskId"
for ($i = 0; $i -lt 30; $i++) { Start-Sleep -Milliseconds 700; $t = ApiGet "$base/tasks/$taskId" $h; if ($t.data.status -in 3,4,5,7) { break } }
Write-Output "status=$($t.data.status) uri=$($t.data.results[0].uri)"

Write-Output "`n--- B3 任务不存在 ---"
$r = ApiGet "$base/tasks/999999999999" $h; Write-Output "code=$($r.code) msg=$($r.msg)"

Write-Output "`n--- B4 下载URL ---"
$dl = ApiGet "$base/tasks/$taskId/results/1/download-url" $h
Write-Output "code=$($dl.code) host=$(([uri]$dl.data.url).Host) expires=$($dl.data.expires_in)"

Write-Output "`n--- B5 分享/公开/举报/撤销 ---"
$sh = ApiPost "$base/tasks/$taskId/share" (@{ expires_in_days = 7 }) $h
$shareTok = $sh.data.token; Write-Output "share code=$($sh.code) token_len=$($shareTok.Length)"
$pub = ApiGet "$base/share/$shareTok" @{}; Write-Output "public code=$($pub.code) task=$($pub.data.task_id)"
$rep = ApiPost "$base/share/$shareTok/report" (@{ reason='illegal'; detail='验收举报' }) @{}
Write-Output "report code=$($rep.code) id=$($rep.data.report_id)"
$rev = ApiDelete "$base/tasks/$taskId/share" $h; Write-Output "revoke code=$($rev.code)"
$pub2 = ApiGet "$base/share/$shareTok" @{}; Write-Output "after revoke code=$($pub2.code)"

Write-Output "`n--- B7 资产目录/转存/标签/回收站 ---"
$fo = ApiPost "$base/asset-folders" (@{ name = '验收目录' }) $h
Write-Output "folder code=$($fo.code) name=$($fo.data.name)"
$af = ApiPost "$base/assets/from-task" (@{ task_id = $taskId; index = 0 }) $h
Write-Output "from-task code=$($af.code) tags=$($af.data.tags -join ',')"
$pa = ApiPatch "$base/assets/$($af.data.id)" (@{ folder_id = $fo.data.id; tags = @('#角色X') }) $h
Write-Output "patch code=$($pa.code) tags=$($pa.data.tags -join ',')"
$fl = ApiGet "$base/assets?tag=$([uri]::EscapeDataString('#角色X'))" $h
Write-Output "tag filter total=$($fl.data.total)"
$rm = ApiDelete "$base/assets/$($af.data.id)" $h; Write-Output "delete code=$($rm.code)"
$bin = ApiGet "$base/assets?deleted=true" $h; Write-Output "recycle total=$($bin.data.total)"
$rs = ApiPost "$base/assets/$($af.data.id)/restore" (@{}) $h; Write-Output "restore code=$($rs.code)"

Write-Output "`n--- B8 项目/矩阵/分镜素材 ---"
$pj = ApiPost "$base/projects" (@{ title='验收项目'; source_type=2; source_text='一个雨夜的故事' }) $h
$projectId = $pj.data.id; Write-Output "project code=$($pj.code) id=$projectId"
$mtx = ApiGet "$base/projects/$projectId/matrix" $h; Write-Output "matrix code=$($mtx.code) episodes=$($mtx.data.episodes.Count)"
$sm = ApiPost "$base/projects/$projectId/shot-materials" (@{ task_id = $taskId }) $h
Write-Output "shot-material code=$($sm.code) kind=$($sm.data.kind)"
$ml = ApiGet "$base/projects/$projectId/shot-materials" $h; Write-Output "materials=$($ml.data.Count)"

Write-Output "`n--- B9 越权访问他人项目 ---"
$u2 = Login '13711110009'
$r = ApiGet "$base/projects/$projectId" $u2.h; Write-Output "other project code=$($r.code) msg=$($r.msg)"

Write-Output "`n--- B10 admin ---"
$ad = ApiPost "$base/ops/admin/login" (@{ username='admin'; password='admin12345' }) @{}
$ah = @{ Authorization = "Bearer $($ad.data.token)" }
$fn = ApiGet "$base/ops/admin/funnel" $ah; Write-Output "funnel stages=$($fn.data.Count) projects=$($fn.data[0].count)"
$tm = ApiGet "$base/ops/admin/task-metrics" $ah; Write-Output "failure_rate=$($tm.data.failure_rate) latency=$($tm.data.adapter_latency.Count)"
$rp = ApiGet "$base/ops/admin/reports" $ah; Write-Output "reports total=$($rp.data.total)"
$r = ApiGet "$base/ops/admin/dashboard" $h; Write-Output "user token on admin code=$($r.code)"
$csv = try { Invoke-WebRequest "$base/ops/admin/failed-tasks.csv" -Headers $ah -UseBasicParsing } catch { $null }
Write-Output "csv status=$($csv.StatusCode) head=$($csv.Content.Split("`n")[0])"
$rs2 = ApiPost "$base/ops/admin/reports/1/resolve" (@{ action='dismiss' }) $ah
Write-Output "resolve nonexistent report code=$($rs2.code)"

Write-Output "`n--- B11 注销后 token 失效 ---"
$u3 = Login '13711110007'
$del = ApiPost "$base/me/delete" (@{}) $u3.h; Write-Output "delete code=$($del.code) purge_after=$($del.data.purge_after)"
$after = ApiGet "$base/me" $u3.h; Write-Output "after delete code=$($after.code) msg=$($after.msg)"

Write-Output "`n--- B12 等待名单 ---"
$wl = ApiPost "$base/waitlist" (@{ phone='13711110008'; source='acceptance' }) @{}
Write-Output "waitlist code=$($wl.code) pos=$($wl.data.position)"
