// -----------------------------------------------------------------------------
// A simulated Node-RED admin API, passed to the code as its `fetch`. Tests
// never touch the network: the integration talks to this object.
// -----------------------------------------------------------------------------

export function createFakeNodeRed({
  username = 'admin',
  password = 'correct-horse',
  version = '5.0.9',
  tabs = [
    { id: 'a1b2c3d4e5f60718', type: 'tab', label: 'Lights', disabled: false, info: 'Hall lights' },
    { id: 'f6f2187d.f17ca8', type: 'tab', label: 'Alarm', disabled: true, info: '' },
  ],
} = {}) {
  const state = {
    online: true,
    running: true,
    tabs: tabs.map((tab) => ({ ...tab })),
    nodes: [{ id: 'n1', type: 'inject', z: 'a1b2c3d4e5f60718' }],
    token: 'token-1',
    username,
    password,
    httpIn: { '/gladys/test': { status: 200, body: 'ok' } },
    received: [],
    calls: [],
  };

  const json = (status, body) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  async function fetch(url, init = {}) {
    const { pathname } = new URL(url);
    const method = init.method ?? 'GET';
    state.calls.push(`${method} ${pathname}`);
    if (!state.online) {
      throw new TypeError('fetch failed');
    }
    const headers = init.headers ?? {};

    if (pathname === '/auth/token' && method === 'POST') {
      const form = new URLSearchParams(init.body);
      if (form.get('username') !== state.username || form.get('password') !== state.password) {
        return json(403, { error: 'unauthorized' });
      }
      return json(200, { access_token: state.token, expires_in: 604800, token_type: 'Bearer' });
    }

    // http in endpoints of the flows
    if (state.httpIn[pathname]) {
      const expected = `Basic ${Buffer.from(`${state.username}:${state.password}`).toString('base64')}`;
      if (headers.authorization !== expected) {
        return new Response('Unauthorized', { status: 401 });
      }
      state.received.push({ pathname, body: JSON.parse(init.body) });
      const { status, body } = state.httpIn[pathname];
      return new Response(body, { status });
    }

    if (!/^\/(settings|flows|flows\/state|flow\/.+)$/.test(pathname)) {
      return json(404, { error: 'not found' });
    }
    if (headers.authorization !== `Bearer ${state.token}`) {
      return json(401, { error: 'unauthorized' });
    }

    if (pathname === '/settings') {
      return json(200, { version, httpNodeRoot: '/' });
    }
    if (pathname === '/flows/state') {
      if (method === 'POST') {
        state.running = JSON.parse(init.body).state === 'start';
      }
      return json(200, { state: state.running ? 'start' : 'stop' });
    }
    if (pathname === '/flows') {
      return json(200, { rev: 'abc', flows: [...state.tabs, ...state.nodes] });
    }
    const flowMatch = /^\/flow\/(.+)$/.exec(pathname);
    if (flowMatch) {
      const id = decodeURIComponent(flowMatch[1]);
      const tab = state.tabs.find((candidate) => candidate.id === id);
      if (!tab) {
        return json(404, { error: 'not found' });
      }
      if (method === 'PUT') {
        const body = JSON.parse(init.body);
        tab.disabled = body.disabled === true;
        return json(200, { id });
      }
      return json(200, {
        id: tab.id,
        label: tab.label,
        disabled: tab.disabled,
        info: tab.info,
        nodes: state.nodes.filter((node) => node.z === tab.id),
      });
    }
    return json(404, { error: 'not found' });
  }

  return { fetch, state };
}
