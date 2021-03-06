import { shallowReactive, shallowRef } from 'vue'

export class RateLimiter {
  stack = shallowReactive<ResourceHandle[]>([])
  queue = shallowRef(0)

  private _destroyed = false

  // eslint-disable-next-line no-useless-constructor
  constructor (
    public max: number,
    public window: number
  ) {}

  wait (borrow = true) {
    return this._wait(borrow)
  }

  private async _wait (borrow: boolean): Promise<void> {
    if (this._destroyed) throw new Error('RateLimiter is no longer active')

    if (this.isFullyUtilized) {
      this.queue.value++
      await this.stack[0].promise
      this.queue.value--
      return this._wait(borrow)
    } else {
      if (borrow) {
        this.push()
      }
    }
  }

  private push () {
    const handle = new ResourceHandle(this.window * 1000, () => {
      const idx = this.stack.indexOf(handle)
      if (idx !== -1) {
        this.stack.splice(idx, 1)
      }
    })
    this.stack.push(handle)
  }

  static async waitMulti (limiters: Iterable<RateLimiter>): Promise<void> {
    const _limiters = Array.from(limiters)

    try {
      await Promise.all(_limiters.map(rl => rl.wait(false)))
    } catch (e) {
      if (e instanceof Error && e.message === 'RateLimiter is no longer active') {
        return this.waitMulti(limiters)
      } else {
        throw e
      }
    }

    if (_limiters.every(rl => !rl.isFullyUtilized)) {
      _limiters.forEach(rl => rl.wait())
    } else {
      return this.waitMulti(limiters)
    }
  }

  isEqualLimit (other: { max: number, window: number }) {
    return this.max === other.max &&
      this.window === other.window
  }

  get isFullyUtilized () {
    return !this.available
  }

  get available () {
    return Math.max(this.max - this.stack.length, 0)
  }

  destroy () {
    this._destroyed = true
    if (this.queue.value) {
      // shortcircuit awaiters
      this.stack[0].cancel(new Error('RateLimiter is no longer active'))
    }
  }

  toString () {
    return `RateLimiter<max=${this.max}:window=${this.window}>: (stack=${this.stack.length},queue=${this.queue.value})`
  }
}

class ResourceHandle {
  public borrowedAt: number
  public promise: Promise<void>

  private _tmid!: ReturnType<typeof setTimeout>
  private _cb: () => void
  private _resolve!: () => void
  private _reject!: (reason?: any) => void

  constructor (millis: number, cb: () => void) {
    this.borrowedAt = Date.now()
    this._cb = cb
    this.promise = new Promise((_resolve, _reject) => {
      this._resolve = _resolve
      this._reject = _reject

      this._tmid = setTimeout(() => {
        this._cb()
        this._resolve()
      }, millis)
    })
  }

  public cancel (reason?: any) {
    clearTimeout(this._tmid)
    this._cb()
    this._reject(reason)
  }
}
