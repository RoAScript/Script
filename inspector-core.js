(function () {
  'use strict';

  if (window.CalciumInspector?.coreLoaded) return;

  const Inspector = window.CalciumInspector || {};
  window.CalciumInspector = Inspector;

  Inspector.coreLoaded = true;

  const STATE = {
    currentClientId: null,
    lastAuthHeader: null,
    dataByCategory: Object.create(null),
    seenByCategory: Object.create(null),
    requestsByCategory: Object.create(null),
     requestMetaByCategory: Object.create(null),
    maxPreviewLength: 700,
    uiEnabled: window === window.top,
    currentFilter: 'all',
    searchText: '',
    maxStoredItemsPerCategory: 50000,
    listeners: [],
    datasetReady: false,
    datasetPreparing: false,
    lastCaptureAt: 0,
    datasetReadyListeners: [],
    expectedCategoryCount: 40,
    datasetStableDelayMs: 2000
  };

  Inspector.state = STATE;

  function safeText(value) {
    if (value == null) return '';
    try {
      return String(value);
    } catch {
      return '';
    }
  }

  function previewText(text, max = STATE.maxPreviewLength) {
    const s = safeText(text);
    return s.length > max ? s.slice(0, max) + '…' : s;
  }

  function safeJsonParse(text) {
    if (typeof text !== 'string') return null;
    const trimmed = text.trim();
    if (!trimmed) return null;
    if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return null;

    try {
      return JSON.parse(trimmed);
    } catch (error) {
      console.warn('[Calcium] JSON parse KO:', error, previewText(trimmed));
      return null;
    }
  }

  function getHeaderCaseInsensitive(headers, name) {
    if (!headers || !name) return null;
    const wanted = name.toLowerCase();

    if (typeof headers.get === 'function') {
      return headers.get(name) || headers.get(wanted);
    }

    if (Array.isArray(headers)) {
      const found = headers.find(([key]) => safeText(key).toLowerCase() === wanted);
      return found ? found[1] : null;
    }

    if (typeof headers === 'object') {
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === wanted) return headers[key];
      }
    }

    return null;
  }

  function updateClientId(clientId) {
    if (!clientId) return;
    STATE.currentClientId = clientId;
  }

  function updateToken(token) {
    if (!token) return;
    STATE.lastAuthHeader = token;
  }


  function shouldReplaceCategoryPayload(category) {
    return (
        /^api\.players\.[^.]+\.actions$/.test(category) ||
        /^api\.players\.[^.]+\.battles\.[^.]+$/.test(category) ||
        /^api\.players\.[^.]+\.battles\.[^.]+\.farm-status$/.test(category) ||
        /^api\.buildings\.[^.]+\.upgrade$/.test(category) ||
        /^api\.researches\.[^.]+\.upgrade$/.test(category)
      );
  }


  function normalizeUrlToCategory(url, data) {
    const raw = safeText(url).trim();

    if (raw) {
      try {
        const absolute = new URL(raw, window.location.origin);
        let path = absolute.pathname.toLowerCase();
        path = path.replace(/^\/+|\/+$/g, '');
        if (!path) return 'root';

        const segments = path
          .split('/')
          .map(s => s.trim())
          .filter(Boolean)
          .map(s => s.replace(/[^a-z0-9_-]/gi, '_'));

        return segments.join('.');
      } catch (error) {
        console.warn('[Calcium] URL normalization KO:', raw, error);
      }
    }

    const items = normalizeItems(data);
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const atId = safeText(item['@id']).trim();
      if (atId) return normalizeUrlToCategory(atId, null);
    }

    return 'unknown';
  }

  function normalizeItems(data) {
    if (!data || typeof data !== 'object') return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data['hydra:member'])) return data['hydra:member'];
    if (Array.isArray(data.member)) return data.member;
    return [data];
  }

  function getDedupKey(item, index) {
    if (!item || typeof item !== 'object') return `primitive:${index}:${safeText(item)}`;

    const keys = [
      item['@id'],
      item.id,
      item.uuid,
      item.code,
      item.slug,
      item.name,
      item.label
    ];

    for (const key of keys) {
      const value = safeText(key).trim();
      if (value) return value;
    }

    try {
      return `json:${JSON.stringify(item)}`;
    } catch {
      return `fallback:${index}`;
    }
  }

  function ensureCategoryState(category) {
    if (!STATE.dataByCategory[category]) STATE.dataByCategory[category] = [];
    if (!STATE.seenByCategory[category]) STATE.seenByCategory[category] = new Set();
    if (!STATE.requestsByCategory[category]) STATE.requestsByCategory[category] = 0;
  }

  function trimCategoryIfNeeded(category) {
    const arr = STATE.dataByCategory[category];
    if (!arr || arr.length <= STATE.maxStoredItemsPerCategory) return;

    const overflow = arr.length - STATE.maxStoredItemsPerCategory;
    arr.splice(0, overflow);

    const rebuilt = new Set();
    arr.forEach((item, index) => rebuilt.add(getDedupKey(item, index)));
    STATE.seenByCategory[category] = rebuilt;
  }

  function mergeCategoryData(category, payload) {
    ensureCategoryState(category);
    STATE.requestsByCategory[category] += 1;

    if (shouldReplaceCategoryPayload(category)) {
      STATE.dataByCategory[category] = [payload];

      const rebuilt = new Set();
      STATE.dataByCategory[category].forEach((item, index) => {
        rebuilt.add(getDedupKey(item, index));
      });
      STATE.seenByCategory[category] = rebuilt;

      return {
        total: STATE.dataByCategory[category].length,
        added: 1,
        requests: STATE.requestsByCategory[category]
      };
    }

    const target = STATE.dataByCategory[category];
    const seen = STATE.seenByCategory[category];
    const items = Array.isArray(payload) ? payload : [payload];

    let added = 0;

    items.forEach((item, index) => {
      const key = getDedupKey(item, index);
      if (seen.has(key)) return;
      seen.add(key);
      target.push(item);
      added += 1;
    });

    trimCategoryIfNeeded(category);

    return {
      total: target.length,
      added,
      requests: STATE.requestsByCategory[category]
    };
  }

  function inspectAuthData(url, data, headers, requestHeaders) {
    const lowerUrl = safeText(url).toLowerCase();

    const authHeader =
      getHeaderCaseInsensitive(headers, 'authorization') ||
      getHeaderCaseInsensitive(requestHeaders, 'authorization');

    if (authHeader) updateToken(authHeader);

    const clientId =
      getHeaderCaseInsensitive(headers, 'x-auth-client-id') ||
      getHeaderCaseInsensitive(requestHeaders, 'x-auth-client-id');

    if (clientId) updateClientId(clientId);

    if (
      lowerUrl.includes('/login') ||
      lowerUrl.includes('/refresh') ||
      lowerUrl.includes('/token')
    ) {
      if (data && typeof data === 'object') {
        if (data.token) updateToken(data.token);
        if (data.access_token) updateToken(data.access_token);
        if (data.jwt) updateToken(data.jwt);
      }
    }
  }

  function isJsonCandidate(contentType, text) {
    const ct = safeText(contentType).toLowerCase();
    const trimmed = safeText(text).trim();

    return (
      ct.includes('json') ||
      ct.includes('ld+json') ||
      trimmed.startsWith('{') ||
      trimmed.startsWith('[')
    );
  }

  function emitChange() {
    STATE.listeners.forEach(listener => {
      try {
        listener(STATE);
      } catch (error) {
        console.warn('[Calcium] listener error:', error);
      }
    });
  }

  function onChange(listener) {
    if (typeof listener !== 'function') return () => {};
    STATE.listeners.push(listener);
    return () => {
      STATE.listeners = STATE.listeners.filter(fn => fn !== listener);
    };
  }

  function setFilter(filterValue) {
    STATE.currentFilter = filterValue || 'all';
    emitChange();
  }

  function setSearchText(value) {
    STATE.searchText = safeText(value);
    emitChange();
  }

  function matchesFilter(category) {
    if (STATE.currentFilter === 'all') return true;
    if (STATE.currentFilter === 'api') return category.startsWith('api.');
    if (STATE.currentFilter === 'other') return !category.startsWith('api.');
    return true;
  }

  function objectContainsSearch(value, needleLower) {
    if (!needleLower) return true;
    if (value == null) return false;

    if (typeof value === 'string') {
      return value.toLowerCase().includes(needleLower);
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value).toLowerCase().includes(needleLower);
    }

    if (Array.isArray(value)) {
      return value.some(item => objectContainsSearch(item, needleLower));
    }

    if (typeof value === 'object') {
      return Object.entries(value).some(([key, nestedValue]) => {
        return (
          safeText(key).toLowerCase().includes(needleLower) ||
          objectContainsSearch(nestedValue, needleLower)
        );
      });
    }

    return false;
  }

  function ensureRequestMetaState(category) {
    if (!STATE.requestMetaByCategory[category]) {
      STATE.requestMetaByCategory[category] = [];
    }
  }

  function headersToObject(headers) {
    if (!headers) return {};

    if (typeof headers.entries === 'function') {
      return Object.fromEntries(Array.from(headers.entries()));
    }

    if (Array.isArray(headers)) {
      return Object.fromEntries(
        headers.map(([key, value]) => [safeText(key), safeText(value)])
      );
    }

    if (typeof headers === 'object') {
      const out = {};
      Object.keys(headers).forEach((key) => {
        out[safeText(key)] = safeText(headers[key]);
      });
      return out;
    }

    return {};
  }

  function sanitizeHeaders(headersObj) {
    const maskedKeys = ['authorization', 'cookie', 'x-auth-token'];
    const out = { ...headersObj };

    Object.keys(out).forEach((key) => {
      if (maskedKeys.includes(key.toLowerCase())) {
        out[key] = '***masked***';
      }
    });

    return out;
  }

  function getQueryParamsObject(url) {
    try {
      const absolute = new URL(url, window.location.origin);
      return Object.fromEntries(absolute.searchParams.entries());
    } catch {
      return {};
    }
  }

  function parseRequestBody(body) {
    if (!body) return null;

    if (typeof body === 'string') {
      const parsed = safeJsonParse(body);
      if (parsed) return parsed;

      try {
        return Object.fromEntries(new URLSearchParams(body).entries());
      } catch {
        return body;
      }
    }

    if (body instanceof URLSearchParams) {
      return Object.fromEntries(body.entries());
    }

    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      return Object.fromEntries(Array.from(body.entries()));
    }

    return safeText(body);
  }

  function pushRequestMeta(category, meta) {
    ensureRequestMetaState(category);
    STATE.requestMetaByCategory[category].push(meta);

    if (STATE.requestMetaByCategory[category].length > STATE.maxStoredItemsPerCategory) {
      STATE.requestMetaByCategory[category].splice(
        0,
        STATE.requestMetaByCategory[category].length - STATE.maxStoredItemsPerCategory
      );
    }
  }

  function getSearchMatchesByCategory() {
    const term = STATE.searchText.trim().toLowerCase();
    const result = Object.create(null);

    Object.keys(STATE.dataByCategory).forEach(category => {
      if (!matchesFilter(category)) return;

      const data = STATE.dataByCategory[category] || [];
      if (!term) {
        result[category] = data.slice();
        return;
      }

      const matches = data.filter(item => objectContainsSearch(item, term));
      if (matches.length > 0) {
        result[category] = matches;
      }
    });

    return result;
  }

  function getSearchResultSummary() {
    const term = STATE.searchText.trim().toLowerCase();
    const matchesByCategory = getSearchMatchesByCategory();
    const categories = Object.keys(matchesByCategory).sort();

    const summary = categories.map(category => ({
      category,
      matchCount: matchesByCategory[category].length,
      requestCount: STATE.requestsByCategory[category] || 0
    }));

    return {
      term,
      categories,
      summary,
      totalCategories: categories.length,
      totalObjects: summary.reduce((acc, item) => acc + item.matchCount, 0)
    };
  }

  function getVisibleCategories() {
    const matchesByCategory = getSearchMatchesByCategory();
    return Object.keys(matchesByCategory).sort();
  }

  function getFilteredPayload(category) {
    const matchesByCategory = getSearchMatchesByCategory();
    return matchesByCategory[category] || [];
  }

  function tryProcessBody(
    url,
    text,
    contentType,
    transport,
    headers,
    requestHeaders,
    method = 'GET',
    requestBody = null
  ) {
    const trimmedText = safeText(text).trim();
    const hasBody = trimmedText.length > 0;

    console.log('Calcium', transport, 'candidate', {
      url,
      contentType,
      hasBody,
      preview: previewText(text)
    });

    const category = normalizeUrlToCategory(url, null);

    pushRequestMeta(category, {
      capturedAt: Date.now(),
      transport: safeText(transport),
      url: safeText(url),
      method: safeText(method || 'GET').toUpperCase(),
      headers: sanitizeHeaders(headersToObject(requestHeaders)),
      query: getQueryParamsObject(url),
      post: parseRequestBody(requestBody),
      responseHeaders: sanitizeHeaders(headersToObject(headers)),
      emptyBody: !hasBody
    });

    if (!hasBody) {
      const result = mergeCategoryData(category, {
        __calciumEmptyResponse: true,
        kind: 'empty-body',
        body: 'Response body is empty',
        contentType: safeText(contentType),
        capturedAt: Date.now()
      });

      STATE.lastCaptureAt = Date.now();
      STATE.datasetReady = false;
      scheduleDatasetCheck();

      console.log(
        `%cCalcium Capture pour ${category}`,
        'color:#50fa7b;font-weight:bold',
        {
          url,
          transport,
          added: result.added,
          total: result.total,
          requests: result.requests,
          emptyBody: true
        }
      );

      emitChange();
      return true;
    }

    if (!isJsonCandidate(contentType, text)) return false;

    const parsed = safeJsonParse(text);
    if (!parsed) return false;

    inspectAuthData(url, parsed, headers, requestHeaders);

    const result = mergeCategoryData(category, parsed);

    STATE.lastCaptureAt = Date.now();
    STATE.datasetReady = false;
    scheduleDatasetCheck();

    console.log(
      `%cCalcium Capture pour ${category}`,
      'color:#50fa7b;font-weight:bold',
      { url, transport, added: result.added, total: result.total, requests: result.requests }
    );

    emitChange();
    return true;
  }

  function interceptFetch() {
    if (typeof window.fetch !== 'function') return;
    const originalFetch = window.fetch;

    window.fetch = async function (...args) {
      const input = args[0];
      const init = args[1] || {};

      let url = '';
      let requestHeaders = null;
      let method = init.method || 'GET';
      let requestBody = init.body ?? null;

      if (typeof input === 'string') {
        url = input;
        requestHeaders = init.headers || null;
      } else if (input && typeof input.url === 'string') {
        url = input.url;
        requestHeaders = input.headers || init.headers || null;
        method = init.method || input.method || 'GET';
        requestBody = init.body ?? null;
      } else if (typeof Request !== 'undefined' && input instanceof Request) {
        url = input.url;
        requestHeaders = input.headers || init.headers || null;
        method = init.method || input.method || 'GET';
        requestBody = init.body ?? null;
      }

      const clientId =
        getHeaderCaseInsensitive(requestHeaders, 'x-auth-client-id') ||
        getHeaderCaseInsensitive(init.headers, 'x-auth-client-id');

      if (clientId) updateClientId(clientId);

      const response = await originalFetch.apply(this, args);

      try {
        const clone = response.clone();
        const responseUrl = safeText(response.url || clone.url || url);
        const contentType = safeText(clone.headers.get('content-type')).toLowerCase();
        const text = await clone.text();

        if (isJsonCandidate(contentType, text)) {
          tryProcessBody(
            responseUrl,
            text,
            contentType,
            'fetch',
            clone.headers,
            requestHeaders,
            method,
            requestBody
          );
        }
      } catch (error) {
        console.warn('Calcium Fetch inspection KO', url, error);
      }

      return response;
    };
  }

  function interceptXHR() {
    if (!window.XMLHttpRequest || !window.XMLHttpRequest.prototype) return;

    const XHR = window.XMLHttpRequest.prototype;
    const originalOpen = XHR.open;
    const originalSend = XHR.send;
    const originalSetRequestHeader = XHR.setRequestHeader;

    XHR.open = function (method, url) {
      this.__calciumMethod = method;
      this.__calciumUrl = url;
      this.__calciumHeaders = Object.create(null);
      this.__calciumBody = null;

      return originalOpen.apply(this, arguments);
    };

    XHR.setRequestHeader = function (name, value) {
      const key = safeText(name).toLowerCase();
      this.__calciumHeaders[key] = value;

      if (key === 'x-auth-client-id') updateClientId(value);
      if (key === 'authorization') updateToken(value);

      return originalSetRequestHeader.apply(this, arguments);
    };

    XHR.send = function (body) {
      this.__calciumBody = body ?? null;

      this.addEventListener(
        'loadend',
        function () {
          try {
            const url = safeText(this.responseURL || this.__calciumUrl);
            const contentType = safeText(
              this.getResponseHeader && this.getResponseHeader('content-type')
            ).toLowerCase();
            const responseText =
              typeof this.responseText === 'string' ? this.responseText : '';

            if (isJsonCandidate(contentType, responseText)) {
              tryProcessBody(
                url,
                responseText,
                contentType,
                'xhr',
                null,
                this.__calciumHeaders,
                this.__calciumMethod || 'GET',
                this.__calciumBody
              );
            }
          } catch (error) {
            console.warn('[Calcium] XHR inspection KO:', error);
          }
        },
        { once: true }
      );

      return originalSend.apply(this, arguments);
    };
  }

  function isPageFullyLoaded() {
    return document.readyState === 'complete';
  }

  function getCategoryCount() {
    return Object.keys(STATE.dataByCategory).length;
  }

  function isDatasetStable() {
    if (!STATE.lastCaptureAt) return false;
    return Date.now() - STATE.lastCaptureAt >= STATE.datasetStableDelayMs;
  }

  function isDatasetReady() {
    return (
      isPageFullyLoaded() &&
      getCategoryCount() >= STATE.expectedCategoryCount &&
      isDatasetStable()
    );
  }

  function emitDatasetReady() {
    STATE.datasetReadyListeners.forEach(listener => {
      try {
        listener({
          categoryCount: getCategoryCount(),
          categories: Object.keys(STATE.dataByCategory).sort(),
          dataByCategory: STATE.dataByCategory
        });
      } catch (error) {
        console.warn('[Calcium] datasetReady listener error:', error);
      }
    });
  }

  function onDatasetReady(listener) {
    if (typeof listener !== 'function') return () => {};
    STATE.datasetReadyListeners.push(listener);

    if (STATE.datasetReady) {
      try {
        listener({
          categoryCount: getCategoryCount(),
          categories: Object.keys(STATE.dataByCategory).sort(),
          dataByCategory: STATE.dataByCategory
        });
      } catch (error) {
        console.warn('[Calcium] datasetReady immediate listener error:', error);
      }
    }

    return () => {
      STATE.datasetReadyListeners = STATE.datasetReadyListeners.filter(fn => fn !== listener);
    };
  }

  function scheduleDatasetCheck() {
    if (STATE.datasetPreparing) return;

    STATE.datasetPreparing = true;

    setTimeout(() => {
      STATE.datasetPreparing = false;

      if (STATE.datasetReady) return;

      if (isDatasetReady()) {
        STATE.datasetReady = true;
        console.log(
          `%c[Calcium] ✅ Dataset prêt pour parsing`,
          'color:#8be9fd;font-weight:bold;',
          {
            readyState: document.readyState,
            categoryCount: getCategoryCount(),
            stableForMs: Date.now() - STATE.lastCaptureAt
          }
        );
        emitDatasetReady();
        emitChange();
        return;
      }

      if (isPageFullyLoaded()) {
        scheduleDatasetCheck();
      }
    }, 500);
  }

  function initDatasetReadyWatcher() {
    if (document.readyState === 'complete') {
      scheduleDatasetCheck();
      return;
    }

    document.addEventListener('readystatechange', () => {
      if (document.readyState === 'complete') {
        scheduleDatasetCheck();
      }
    });
  }

  Inspector.api = {
    safeText,
    previewText,
    setFilter,
    setSearchText,
    onChange,
    getVisibleCategories,
    getFilteredPayload,
    normalizeUrlToCategory,
    getSearchMatchesByCategory,
    getSearchResultSummary,
    onDatasetReady,
    isDatasetReady,
    getCategoryCount
  };

  console.log('🚀 [Calcium] core prêt');
  interceptFetch();
  interceptXHR();

  initDatasetReadyWatcher();
})();