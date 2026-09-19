// Run: node --test lib/emer/hospitals.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { HOSPITALS, driveMinutes, milesBetween, ourWait, rankOptions, suggest, syntheticStatus } from "./hospitals.ts"

const st = (id, wait, diversion = false) => {
  const h = HOSPITALS.find((x) => x.id === id)
  return { ...h, busy: 70, wait, diversion, simulated: !h.ours }
}

test("distance: Hopkins to Mercy is about 1.1 miles", () => {
  const d = milesBetween(HOSPITALS[0].pos, HOSPITALS[2].pos)
  assert.ok(d > 0.9 && d < 1.3, `got ${d}`)
})

test("drive time: 5 miles is about 16 minutes, never below 1", () => {
  assert.equal(driveMinutes(5), 16)
  assert.equal(driveMinutes(0), 1)
})

test("our wait grows with the queue and a full ER", () => {
  assert.equal(ourWait(10, 0, 50), 10)
  assert.equal(ourWait(10, 5, 50), 20)
  assert.equal(ourWait(10, 5, 100), 35)
})

test("synthetic numbers stay in range", () => {
  for (const h of HOSPITALS.filter((x) => !x.ours))
    for (let c = 0; c < 500; c += 7) {
      const s = syntheticStatus(h, c)
      assert.ok(s.busy >= 20 && s.busy <= 110 && s.wait >= 0)
    }
})

test("suggests a farther hospital when the closest one's wait is long", () => {
  const from = HOSPITALS[0].pos // standing at Hopkins
  const opts = rankOptions(from, [st("jhh", 60), st("mercy", 5), st("sinai", 5)])
  const { best, closest, saves } = suggest(opts)
  assert.equal(closest?.id, "jhh")
  assert.equal(best?.id, "mercy")
  assert.ok(saves > 40)
})

test("no suggestion change when the closest is also fastest", () => {
  const opts = rankOptions(HOSPITALS[0].pos, [st("jhh", 5), st("mercy", 5)])
  const { best, saves } = suggest(opts)
  assert.equal(best?.id, "jhh")
  assert.equal(saves, 0)
})

test("a hospital on diversion is never the suggestion", () => {
  const opts = rankOptions(HOSPITALS[0].pos, [st("jhh", 0, true), st("mercy", 30)])
  assert.equal(suggest(opts).best?.id, "mercy")
  assert.equal(opts.at(-1)?.id, "jhh")
})
