(function () {
  'use strict';

  if (window.__calciumBridgeLoaded) return;
  window.__calciumBridgeLoaded = true;

  const REQUEST_SOURCE = 'CALCIUM_BRIDGE_REQUEST';
  const RESPONSE_SOURCE = 'CALCIUM_BRIDGE_RESPONSE';
  const PUSH_SOURCE = 'CALCIUM_BRIDGE_PUSH';

  function postToMain(payload) {
    return new Promise((resolve) => {
      const requestId = `calcium-${Date.now()}-${Math.random().toString(16).slice(2)}`;

      function onMessage(event) {
        if (event.source !== window) return;
        if (event.origin !== window.location.origin) return;

        const data = event.data;
        if (!data || data.source !== RESPONSE_SOURCE) return;
        if (data.requestId !== requestId) return;

        window.removeEventListener('message', onMessage);
        resolve(data.response || { ok: false, error: 'NO_RESPONSE' });
      }

      window.addEventListener('message', onMessage);

      window.postMessage({
        source: REQUEST_SOURCE,
        requestId,
        payload
      }, window.location.origin);
    });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;

    const data = event.data;
    if (!data || data.source !== PUSH_SOURCE) return;

    chrome.runtime.sendMessage({
      type: 'CALCIUM_STATE_UPDATED',
      reason: data.payload?.reason || 'unknown',
      snapshot: data.payload?.snapshot || null
    }).catch?.(() => {});
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    Promise.resolve()
      .then(async () => {
        if (message?.type === 'CALCIUM_GET_STATE') {
          return await postToMain({ type: 'CALCIUM_GET_STATE' });
        }

        if (message?.type === 'CALCIUM_SET_FILTER') {
          return await postToMain({
            type: 'CALCIUM_SET_FILTER',
            filter: message.filter
          });
        }

        if (message?.type === 'CALCIUM_SET_SEARCH_TEXT') {
          return await postToMain({
            type: 'CALCIUM_SET_SEARCH_TEXT',
            text: message.text
          });
        }

        if (message?.type === 'CALCIUM_REFRESH_TOKEN') {
          return await postToMain({ type: 'CALCIUM_REFRESH_TOKEN' });
        }

        if (message?.type === 'CALCIUM_API_REQUEST') {
          return await postToMain({
            type: 'CALCIUM_API_REQUEST',
            path: message.path,
            method: message.method,
            json: message.json,
            headers: message.headers
          });
        }

        return { ok: false, error: 'UNKNOWN_MESSAGE' };
      })
      .then((response) => sendResponse(response))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error?.message || String(error)
        });
      });

    return true;
  });

  console.log('🚀 [Calcium] SidePanel bridge ISOLATED prêt');
})();