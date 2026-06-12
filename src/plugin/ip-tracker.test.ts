/**
 * IPTracker 单元测试
 * 验证 IP 关联检测、共享权重计算、玩家注册/注销等核心逻辑
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { IPTracker } from './ip-tracker.js'

describe('IPTracker', () => {
  let ipTracker: IPTracker

  beforeEach(() => {
    ipTracker = new IPTracker(0.7)
  })

  it('should track players by IP', () => {
    ipTracker.registerPlayer('player1', '192.168.1.1')
    ipTracker.registerPlayer('player2', '192.168.1.1')
    ipTracker.registerPlayer('player3', '192.168.1.2')

    const associates1 = ipTracker.getAssociatedPlayers('player1')
    expect(associates1).toContain('player2')
    expect(associates1).not.toContain('player3')
    expect(associates1.length).toBe(1)
  })

  it('should return empty array for player with no associates', () => {
    ipTracker.registerPlayer('player1', '10.0.0.1')
    expect(ipTracker.getAssociatedPlayers('player1').length).toBe(0)
  })

  it('should return empty array for unknown player', () => {
    expect(ipTracker.getAssociatedPlayers('ghost').length).toBe(0)
  })

  it('should return base weight 1.0 for player with no associates', () => {
    ipTracker.registerPlayer('player1', '10.0.0.1')
    expect(ipTracker.getSharedVPWeight('player1')).toBe(1.0)
  })

  it('should increase VP weight for players sharing IPs', () => {
    const sharedWeight = 0.7
    ipTracker = new IPTracker(sharedWeight)

    ipTracker.registerPlayer('player1', '192.168.1.1')
    ipTracker.registerPlayer('player2', '192.168.1.1')
    ipTracker.registerPlayer('player3', '192.168.1.1')

    // player1: 1.0 + 2 * 0.7 = 2.4
    expect(ipTracker.getSharedVPWeight('player1')).toBeCloseTo(2.4, 1)
    // player2: 1.0 + 2 * 0.7 = 2.4
    expect(ipTracker.getSharedVPWeight('player2')).toBeCloseTo(2.4, 1)
  })

  it('should remove player from tracking', () => {
    ipTracker.registerPlayer('player1', '192.168.1.1')
    ipTracker.registerPlayer('player2', '192.168.1.1')

    ipTracker.removePlayer('player1')
    expect(ipTracker.getAssociatedPlayers('player2').length).toBe(0)
    expect(ipTracker.getAssociatedPlayers('player1').length).toBe(0)
  })

  it('should handle multiple players across different IPs', () => {
    ipTracker.registerPlayer('p1', '10.0.0.1')
    ipTracker.registerPlayer('p2', '10.0.0.1')
    ipTracker.registerPlayer('p3', '10.0.0.1')
    ipTracker.registerPlayer('p4', '10.0.0.2')
    ipTracker.registerPlayer('p5', '10.0.0.2')

    // p1 shares IP with p2 and p3
    expect(ipTracker.getAssociatedPlayers('p1').length).toBe(2)
    expect(ipTracker.getSharedVPWeight('p1')).toBeCloseTo(2.4, 1)

    // p4 shares IP with p5
    expect(ipTracker.getAssociatedPlayers('p4').length).toBe(1)
    expect(ipTracker.getSharedVPWeight('p4')).toBeCloseTo(1.7, 1)
  })

  it('should update player IP on re-register', () => {
    ipTracker.registerPlayer('player1', '10.0.0.1')
    ipTracker.registerPlayer('player2', '10.0.0.1')
    expect(ipTracker.getAssociatedPlayers('player1').length).toBe(1)

    // player1 changes IP
    ipTracker.registerPlayer('player1', '10.0.0.2')
    expect(ipTracker.getAssociatedPlayers('player1').length).toBe(0)
    expect(ipTracker.getAssociatedPlayers('player2').length).toBe(0)
  })
})