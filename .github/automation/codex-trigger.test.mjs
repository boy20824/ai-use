import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accepts } from './codex-trigger.mjs'
const payload = () => ({
  action: 'created',
  issue: { state: 'open' },
  comment: { user: { login: 'grok-example[bot]' }, body: '@codex 請實作這個需求' },
})
test('only the configured account can request development', () => {
  assert.equal(accepts(payload(), 'issue_comment', 'grok-example[bot]'), true)
  assert.equal(accepts(payload(), 'issue_comment', ''), false)
  assert.equal(accepts(payload(), 'issue_comment', 'another[bot]'), false)
})
test('does not respond to PRs, closed issues, edits, or unrelated mentions', () => {
  for (const change of [
    (p) => {
      p.issue.pull_request = {}
    },
    (p) => {
      p.issue.state = 'closed'
    },
    (p) => {
      p.action = 'edited'
    },
    (p) => {
      p.comment.body = '@codex-other hello'
    },
    (p) => {
      p.comment.body = 'hello'
    },
  ]) {
    const p = payload()
    change(p)
    assert.equal(accepts(p, 'issue_comment', 'grok-example[bot]'), false)
  }
})
test('accepts a newly opened issue authored by the configured bot', () => {
  const p = {
    action: 'opened',
    issue: { state: 'open', user: { login: 'grok-example[bot]' }, body: '@codex: 請實作' },
  }
  assert.equal(accepts(p, 'issues', 'grok-example[bot]'), true)
  assert.equal(accepts(p, 'pull_request', 'grok-example[bot]'), false)
})

test('accepts Grok posting as boy20824 and rejects other authors', () => {
  const p = payload()
  p.comment.user.login = 'boy20824'
  assert.equal(accepts(p, 'issue_comment', 'boy20824'), true)
  p.comment.user.login = 'other-user'
  assert.equal(accepts(p, 'issue_comment', 'boy20824'), false)
})
