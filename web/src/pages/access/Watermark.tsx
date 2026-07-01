// 终端水印（对齐 demo antd Watermark）：重复斜向文字覆盖层，不拦截鼠标。
export default function Watermark({ text }: { text: string }) {
  if (!text) return null
  // 用一个倾斜的 SVG 平铺做水印
  const svg = encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='140'>
      <text x='0' y='70' transform='rotate(-22 0 70)' fill='rgba(255,255,255,0.06)' font-size='14' font-family='sans-serif'>${text}</text>
    </svg>`,
  )
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 5,
        backgroundImage: `url("data:image/svg+xml,${svg}")`,
        backgroundRepeat: 'repeat',
      }}
    />
  )
}
