/**
 * Agent 守卫通过后注入到 request.user 的对象
 * 与 AdminCurrentUser 类似，但携带 agentId 和授权信息
 */
export interface AgentCurrentUser {
  sub: string                 // agentId
  typ: 'agent'                // token 类型
  scenario: string            // wallet / merchant / risk / support
  scopes: string[]            // Agent 自身 scopes
  // 当前请求的主体（被代理的用户/商户），从 AgentAuthorization 解析
  subjectType?: string        // user / merchant
  subjectId?: string
  authId?: string             // AgentAuthorization.id
  authScopes?: string[]       // 授权范围（必须是 Agent.scopes 的子集）
}
