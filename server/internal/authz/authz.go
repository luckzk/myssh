// Package authz 资产访问控制：把「授权策略」解析为某用户可访问的资产集合。
// 只依赖 model + gorm，供 access / resource 等包复用，避免包间循环依赖。
package authz

import (
	"encoding/json"

	"github.com/dushixiang/next-terminal-clone/server/internal/model"
	"gorm.io/gorm"
)

func parseIDs(s string) []string {
	out := []string{}
	if s != "" {
		_ = json.Unmarshal([]byte(s), &out)
	}
	return out
}

// descendantAssetGroupIDs 返回给定分组集合的自身 + 所有后代分组 id。
func descendantAssetGroupIDs(db *gorm.DB, roots []string) map[string]struct{} {
	var rows []model.AssetGroup
	db.Find(&rows)
	children := map[string][]string{}
	for _, r := range rows {
		children[r.ParentID] = append(children[r.ParentID], r.ID)
	}
	seen := map[string]struct{}{}
	queue := append([]string{}, roots...)
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		if _, ok := seen[cur]; ok {
			continue
		}
		seen[cur] = struct{}{}
		queue = append(queue, children[cur]...)
	}
	return seen
}

// AuthorizedAssetIDs 汇总某用户被授权访问的资产 id 集合：
// 遍历所有启用且包含该用户的授权策略 → 并集直授资产 + 授权分组（含子分组）下的资产。
func AuthorizedAssetIDs(db *gorm.DB, userID string) (map[string]struct{}, error) {
	var auths []model.Authorization
	if err := db.Where("enabled = ?", true).Find(&auths).Error; err != nil {
		return nil, err
	}
	assetIDs := map[string]struct{}{}
	groupRoots := map[string]struct{}{}
	for _, a := range auths {
		matched := false
		for _, uid := range parseIDs(a.UserIDs) {
			if uid == userID {
				matched = true
				break
			}
		}
		if !matched {
			continue
		}
		for _, aid := range parseIDs(a.AssetIDs) {
			assetIDs[aid] = struct{}{}
		}
		for _, gid := range parseIDs(a.AssetGroupIDs) {
			groupRoots[gid] = struct{}{}
		}
	}
	// 展开授权分组（含子分组）→ 命中这些分组的资产
	if len(groupRoots) > 0 {
		roots := make([]string, 0, len(groupRoots))
		for g := range groupRoots {
			roots = append(roots, g)
		}
		groups := descendantAssetGroupIDs(db, roots)
		gids := make([]string, 0, len(groups))
		for g := range groups {
			gids = append(gids, g)
		}
		var assets []model.Asset
		db.Select("id").Where("group_id IN ?", gids).Find(&assets)
		for _, a := range assets {
			assetIDs[a.ID] = struct{}{}
		}
	}
	return assetIDs, nil
}

// CanAccess 判断用户能否访问某资产。admin 直通；其余按授权集合判定。
func CanAccess(db *gorm.DB, u *model.User, assetID string) bool {
	if u == nil {
		return false
	}
	if u.Type == "admin" {
		return true
	}
	ids, err := AuthorizedAssetIDs(db, u.ID)
	if err != nil {
		return false
	}
	_, ok := ids[assetID]
	return ok
}
