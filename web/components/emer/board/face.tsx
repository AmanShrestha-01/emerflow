// A flat cartoon headshot for a bed card. The face comes from the patient's id, so the same patient always
// looks the same, and from their age: children have rounder faces and bigger eyes, older patients grey hair.
// Drawings we generate for synthetic patients: no photos, no real faces.

const SKIN = ["#f6d9c0", "#ebc09b", "#d69c72", "#ad7149", "#7f5134", "#5c3a26"]
const HAIR = ["#2c2621", "#4a3524", "#8a5a2b", "#c79a5b", "#b4552f", "#1f1b18"]
const GREY = ["#c9c3ba", "#ded9d1", "#9b958c"]

// Drawn for a face centred at (20, 21) with radius 11 on a 40x40 canvas.
const TOP = "M9.2 21.4C9.2 14.4 14 9.6 20 9.6s10.8 4.8 10.8 11.8c-1.7-4.6-5.6-6.8-10.8-6.8S10.9 16.8 9.2 21.4Z"
const RECEDING = "M10.6 20.2c1.1-5 4.6-7.8 9.4-7.8s8.3 2.8 9.4 7.8c-2.4-3-5.6-4.3-9.4-4.3s-7 1.3-9.4 4.3Z"
const LONG_BACK = "M8.6 21.4C8.6 14 13.7 9 20 9s11.4 5 11.4 12.4V31a3 3 0 0 1-3 3h-1.3V20.6H11.9V34h-1.3a3 3 0 0 1-3-3Z"
const BEARD = "M11.4 22.8c0 6.1 3.8 9.6 8.6 9.6s8.6-3.5 8.6-9.6c-1.7 3.2-4.9 4.7-8.6 4.7s-6.9-1.5-8.6-4.7Z"

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

export function PatientFace({ pid, severity, age, size = 36, className = "" }: { pid: string; severity?: number; age?: number; size?: number; className?: string }) {
  const h = hash(pid)
  const old = (age ?? 40) >= 65
  const child = (age ?? 40) < 16
  const skin = SKIN[h % SKIN.length]
  const hair = old ? GREY[(h >> 3) % GREY.length] : HAIR[(h >> 3) % HAIR.length]
  const longHair = ((h >> 6) % 2) === 0 // reads as a woman; the other half reads as a man
  const bun = longHair && !child && ((h >> 8) % 3) === 0
  const beard = !longHair && !child && ((h >> 10) % 3) === 0
  const receding = old && !longHair && ((h >> 12) % 2) === 0
  const glasses = child ? false : old ? ((h >> 14) % 2) === 0 : ((h >> 14) % 5) === 0
  const worried = (severity ?? 5) <= 2 // the sickest are not smiling

  const r = child ? 12 : 11
  const eyeY = child ? 22.5 : 21
  const eyeR = child ? 1.7 : 1.35
  const eyeX = child ? 3.3 : 3.6
  const mouthY = child ? 27.5 : 26

  return (
    <svg viewBox="0 0 40 40" width={size} height={size} className={className} role="img" aria-label="Patient">
      {longHair && !bun && <path d={LONG_BACK} fill={hair} />}
      <circle cx="20" cy={child ? 22 : 21} r={r} fill={skin} />
      {beard && <path d={BEARD} fill={hair} />}
      <path d={receding ? RECEDING : TOP} fill={hair} />
      {bun && <circle cx="20" cy="7.6" r="3.3" fill={hair} />}

      <circle cx={20 - eyeX} cy={eyeY} r={eyeR} fill="#2b2b2b" />
      <circle cx={20 + eyeX} cy={eyeY} r={eyeR} fill="#2b2b2b" />
      {child && (
        <>
          <circle cx={20 - eyeX - 3} cy={eyeY + 3} r="1.7" fill="#e98c77" opacity="0.45" />
          <circle cx={20 + eyeX + 3} cy={eyeY + 3} r="1.7" fill="#e98c77" opacity="0.45" />
        </>
      )}
      {old && (
        <g stroke="#8a6c56" strokeWidth="0.7" strokeLinecap="round" opacity="0.5" fill="none">
          <path d="M12.6 19.4q1.5-1.1 3-0.5" />
          <path d="M27.4 19.4q-1.5-1.1-3-0.5" />
        </g>
      )}
      {glasses && (
        <g fill="none" stroke="#2b2b2b" strokeWidth="0.9" opacity="0.85">
          <circle cx={20 - eyeX} cy={eyeY} r="3.1" />
          <circle cx={20 + eyeX} cy={eyeY} r="3.1" />
          <path d="M19.1 21h1.8" />
        </g>
      )}
      {worried ? (
        <path d={`M17.2 ${mouthY}h5.6`} stroke="#2b2b2b" strokeWidth="1.2" strokeLinecap="round" fill="none" />
      ) : (
        <path d={`M17.2 ${mouthY - 0.7}q2.8 2.4 5.6 0`} stroke="#2b2b2b" strokeWidth="1.2" strokeLinecap="round" fill="none" />
      )}
    </svg>
  )
}
