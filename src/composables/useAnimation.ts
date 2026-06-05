/**
 * 组件动画优化 Composable
 * 流畅过渡动画，支持动画队列和性能优化。
 *
 * 用法:
 *   const { animate, fadeIn, fadeOut, slideIn, bounce } = useAnimation()
 *   fadeIn(element, { duration: 300 })
 */

import { ref, onUnmounted } from 'vue'

interface AnimationOptions {
  duration?: number
  easing?: string
  delay?: number
  fill?: 'none' | 'forwards' | 'backwards' | 'both'
}

const DEFAULT_OPTIONS: Required<AnimationOptions> = {
  duration: 300,
  easing: 'ease-out',
  delay: 0,
  fill: 'forwards',
}

export function useAnimation() {
  const isAnimating = ref(false)
  const animations = new Set<Animation>()

  /** 通用动画执行 */
  function animate(
    element: HTMLElement,
    keyframes: Keyframe[],
    options: AnimationOptions = {}
  ): Promise<void> {
    const config = { ...DEFAULT_OPTIONS, ...options }

    return new Promise((resolve) => {
      isAnimating.value = true
      const animation = element.animate(keyframes, {
        duration: config.duration,
        easing: config.easing,
        delay: config.delay,
        fill: config.fill,
      })

      animations.add(animation)

      animation.onfinish = () => {
        animations.delete(animation)
        isAnimating.value = animations.size > 0
        resolve()
      }

      animation.oncancel = () => {
        animations.delete(animation)
        isAnimating.value = animations.size > 0
        resolve()
      }
    })
  }

  /** 淡入 */
  function fadeIn(element: HTMLElement, options: AnimationOptions = {}): Promise<void> {
    return animate(element, [
      { opacity: 0, transform: 'translateY(-10px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ], options)
  }

  /** 淡出 */
  function fadeOut(element: HTMLElement, options: AnimationOptions = {}): Promise<void> {
    return animate(element, [
      { opacity: 1, transform: 'translateY(0)' },
      { opacity: 0, transform: 'translateY(-10px)' },
    ], options)
  }

  /** 滑入 */
  function slideIn(element: HTMLElement, direction: 'left' | 'right' | 'up' | 'down' = 'left', options: AnimationOptions = {}): Promise<void> {
    const transforms: Record<string, [string, string]> = {
      left: ['translateX(-100%)', 'translateX(0)'],
      right: ['translateX(100%)', 'translateX(0)'],
      up: ['translateY(-100%)', 'translateY(0)'],
      down: ['translateY(100%)', 'translateY(0)'],
    }

    const [from, to] = transforms[direction]
    return animate(element, [
      { transform: from, opacity: 0 },
      { transform: to, opacity: 1 },
    ], options)
  }

  /** 滑出 */
  function slideOut(element: HTMLElement, direction: 'left' | 'right' | 'up' | 'down' = 'left', options: AnimationOptions = {}): Promise<void> {
    const transforms: Record<string, [string, string]> = {
      left: ['translateX(0)', 'translateX(-100%)'],
      right: ['translateX(0)', 'translateX(100%)'],
      up: ['translateY(0)', 'translateY(-100%)'],
      down: ['translateY(0)', 'translateY(100%)'],
    }

    const [from, to] = transforms[direction]
    return animate(element, [
      { transform: from, opacity: 1 },
      { transform: to, opacity: 0 },
    ], options)
  }

  /** 弹跳 */
  function bounce(element: HTMLElement, options: AnimationOptions = {}): Promise<void> {
    return animate(element, [
      { transform: 'translateY(0)' },
      { transform: 'translateY(-20px)' },
      { transform: 'translateY(0)' },
      { transform: 'translateY(-10px)' },
      { transform: 'translateY(0)' },
    ], { duration: 600, ...options })
  }

  /** 缩放 */
  function scale(element: HTMLElement, from: number = 0, to: number = 1, options: AnimationOptions = {}): Promise<void> {
    return animate(element, [
      { transform: `scale(${from})`, opacity: 0 },
      { transform: `scale(${to})`, opacity: 1 },
    ], options)
  }

  /** 闪烁 */
  function flash(element: HTMLElement, options: AnimationOptions = {}): Promise<void> {
    return animate(element, [
      { opacity: 1 },
      { opacity: 0.3 },
      { opacity: 1 },
      { opacity: 0.3 },
      { opacity: 1 },
    ], { duration: 600, ...options })
  }

  /** 震动 */
  function shake(element: HTMLElement, options: AnimationOptions = {}): Promise<void> {
    return animate(element, [
      { transform: 'translateX(0)' },
      { transform: 'translateX(-5px)' },
      { transform: 'translateX(5px)' },
      { transform: 'translateX(-5px)' },
      { transform: 'translateX(5px)' },
      { transform: 'translateX(0)' },
    ], { duration: 400, ...options })
  }

  /** 脉冲 */
  function pulse(element: HTMLElement, options: AnimationOptions = {}): Promise<void> {
    return animate(element, [
      { transform: 'scale(1)', opacity: 1 },
      { transform: 'scale(1.05)', opacity: 0.8 },
      { transform: 'scale(1)', opacity: 1 },
    ], { duration: 600, ...options })
  }

  /** 旋转 */
  function rotate(element: HTMLElement, degrees: number = 360, options: AnimationOptions = {}): Promise<void> {
    return animate(element, [
      { transform: 'rotate(0deg)' },
      { transform: `rotate(${degrees}deg)` },
    ], options)
  }

  /** 取消所有动画 */
  function cancelAll() {
    animations.forEach(animation => animation.cancel())
    animations.clear()
    isAnimating.value = false
  }

  onUnmounted(() => {
    cancelAll()
  })

  return {
    isAnimating,
    animate,
    fadeIn,
    fadeOut,
    slideIn,
    slideOut,
    bounce,
    scale,
    flash,
    shake,
    pulse,
    rotate,
    cancelAll,
  }
}
