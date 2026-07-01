import { atom } from 'jotai'
import type { AccountInfo, Branding } from '../api/auth'

// 全局原子状态（对齐探查到的 Jotai 用法）。
export const accountAtom = atom<AccountInfo | null>(null)
export const brandingAtom = atom<Branding | null>(null)
