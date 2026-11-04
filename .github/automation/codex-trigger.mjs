const mention = /(^|\s)@codex(?=$|[\s:,.!?])/i

function accepts(payload, eventName, trustedBot) {
  if (!trustedBot || !payload.issue || payload.issue.pull_request) return false
  if (payload.issue.state !== 'open') return false
  const source =
    eventName === 'issue_comment' && payload.action === 'created'
      ? payload.comment
      : eventName === 'issues' && payload.action === 'opened'
        ? payload.issue
        : null
  return Boolean(source && source.user?.login === trustedBot && mention.test(source.body || ''))
}

export { accepts }
