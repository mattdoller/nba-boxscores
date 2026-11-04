// Stand-ins for stats.nba.com, so tests never touch the network.

const realFetch = globalThis.fetch;

// Answers requests to stats.nba.com from `routes`, keyed by endpoint name.
// A route is a JSON body, a Response, or a function of the request's search
// params returning either. Other requests (like ones to a test server) go to
// the real fetch. Returns the list of stats.nba.com calls made, which fills
// in as requests arrive. The stub is removed when test `t` ends.
//
// Responses are cached by URL for the life of the test process, so each test
// should request URLs (game ids, seasons) no other test in its file uses.
export function stubStatsApi(t, routes) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input);
    if (url.hostname !== "stats.nba.com") {
      return realFetch(input, init);
    }

    const endpoint = url.pathname.split("/").pop();
    calls.push({ endpoint, params: Object.fromEntries(url.searchParams), init });
    let body = routes[endpoint];
    if (typeof body === "function") {
      body = body(url.searchParams);
    }
    if (body === undefined) {
      return new Response("Not Found", { status: 404 });
    }
    if (body instanceof Response) {
      return body;
    }

    return Response.json(body);
  });
  return calls;
}

// The { resultSets: [{ name, headers, rowSet }] } shape older endpoints
// return, built from row objects.
export function resultSets(sets) {
  return {
    resultSets: Object.entries(sets).map(([name, rows]) => {
      const headers = Object.keys(rows[0] ?? {});
      return { name, headers, rowSet: rows.map((row) => headers.map((h) => row[h])) };
    }),
  };
}
