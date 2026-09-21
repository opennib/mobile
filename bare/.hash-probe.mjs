import fs from "bare-fs"
import crypto from "bare-crypto"
const [p] = Bare.argv.slice(2)
const t0 = Date.now()
const h = crypto.createHash("sha256")
const fd = fs.openSync(p, "r"); const buf = Buffer.alloc(1 << 20); let n
while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n))
fs.closeSync(fd)
console.log("sha256", h.digest("hex").slice(0, 16), "in", Date.now() - t0, "ms")
