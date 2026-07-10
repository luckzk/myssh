package access

import (
	"strconv"
	"strings"

	"github.com/dushixiang/next-terminal-clone/server/internal/model"
	"github.com/dushixiang/next-terminal-clone/server/internal/web"
	"github.com/labstack/echo/v4"
)

// statsScript 自包含脚本：采两次 /proc/stat、/proc/net/dev 算 CPU%/网络速率，
// 再取内存/负载/磁盘/系统信息，输出 key=value。
const statsScript = `
net_sum() { awk 'NR>2{gsub(/:/," "); if($1!="lo"){rx+=$2; tx+=$10}} END{print rx" "tx}' /proc/net/dev; }
read a b c d e f g rest < /proc/stat; t1=$((b+c+d+e+f+g)); i1=$e
read nrx1 ntx1 <<EOF
$(net_sum)
EOF
sleep 0.7
read a b c d e f g rest < /proc/stat; t2=$((b+c+d+e+f+g)); i2=$e
read nrx2 ntx2 <<EOF
$(net_sum)
EOF
dt=$((t2-t1)); di=$((i2-i1))
cpu=0; [ "$dt" -gt 0 ] && cpu=$(( (100*(dt-di))/dt ))
echo "cpu=$cpu"
echo "net_rx=$(( (nrx2-nrx1)*10/7 ))"
echo "net_tx=$(( (ntx2-ntx1)*10/7 ))"
mt=$(awk '/^MemTotal/{print $2}' /proc/meminfo)
ma=$(awk '/^MemAvailable/{print $2}' /proc/meminfo)
mf=$(awk '/^MemFree/{print $2}' /proc/meminfo)
mc=$(awk '/^Cached/{print $2}' /proc/meminfo); mb=$(awk '/^Buffers/{print $2}' /proc/meminfo)
echo "mem_total=$mt"; echo "mem_avail=$ma"; echo "mem_free=$mf"; echo "mem_cache=$((mc+mb))"
echo "load=$(cut -d" " -f1-3 /proc/loadavg)"
df -kP / | awk 'NR==2{print "disk_used="$3; print "disk_total="$2; print "disk_pct="$5}'
echo "uptime=$(cut -d. -f1 /proc/uptime)"
echo "host=$(hostname)"
echo "os=$(uname -s) $(uname -r)"
echo "arch=$(uname -m)"
`

// stats 经 SSH 在会话目标上一次性采集主机指标。
func (h *Handler) stats(c echo.Context) error {
	u := web.CurrentUser(c)
	sessionID := c.QueryParam("sessionId")
	var sess model.ConnSession
	if err := h.store.DB.First(&sess, "id = ? AND user_id = ?", sessionID, u.ID).Error; err != nil {
		return web.Fail(c, 200, 404, "会话不存在")
	}
	var a model.Asset
	if err := h.store.DB.First(&a, "id = ?", sess.AssetID).Error; err != nil {
		return web.Fail(c, 200, 404, "资产不存在")
	}
	target, err := h.resolveTarget(&a)
	if err != nil {
		return web.Fail(c, 200, 500, "凭证解析失败: "+err.Error())
	}
	out, runErr := h.sshPool.Run(poolKey(u.ID, target), *target, statsScript, h.sshOptionsForUser(u.ID))
	if runErr != nil && strings.TrimSpace(out) == "" {
		return web.Fail(c, 200, 500, "采集失败: "+runErr.Error())
	}

	kv := map[string]string{}
	for _, line := range strings.Split(out, "\n") {
		if i := strings.IndexByte(line, '='); i > 0 {
			kv[strings.TrimSpace(line[:i])] = strings.TrimSpace(line[i+1:])
		}
	}
	atoi := func(s string) int64 { n, _ := strconv.ParseInt(strings.TrimSpace(s), 10, 64); return n }
	memTotal := atoi(kv["mem_total"]) // KB
	memAvail := atoi(kv["mem_avail"])
	memUsed := memTotal - memAvail
	memPct := 0
	if memTotal > 0 {
		memPct = int(memUsed * 100 / memTotal)
	}

	return web.OK(c, map[string]any{
		"cpuPct":      int(atoi(kv["cpu"])),
		"memUsedKB":   memUsed,
		"memTotalKB":  memTotal,
		"memFreeKB":   atoi(kv["mem_free"]),
		"memCacheKB":  atoi(kv["mem_cache"]),
		"memPct":      memPct,
		"load":        kv["load"],
		"diskUsedKB":  atoi(kv["disk_used"]),
		"diskTotalKB": atoi(kv["disk_total"]),
		"diskPct":     strings.TrimSuffix(kv["disk_pct"], "%"),
		"netRxBps":    atoi(kv["net_rx"]),
		"netTxBps":    atoi(kv["net_tx"]),
		"uptimeSec":   atoi(kv["uptime"]),
		"host":        kv["host"],
		"os":          kv["os"],
		"arch":        kv["arch"],
	})
}
