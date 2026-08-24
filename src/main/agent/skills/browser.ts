/**
 * Michaelangelo Agent - Headless Browser Skill
 *
 * Integrates Playwright as a callable tool for the agent to:
 * - Take screenshots of web pages (including localhost dev servers)
 * - Navigate to URLs and inspect rendered DOM
 * - Evaluate JavaScript in the page context
 * - Get page content for analysis
 *
 * This enables the agent to:
 * 1. Start a dev server (via run_command)
 * 2. Navigate to localhost and take a screenshot
 * 3. Analyze the rendered output
 * 4. Fix CSS/layout issues autonomously
 */

import * as path from 'path';
import * as fs from 'fs';
import { AgentSkill, ExecutionContext, ToolResult, ToolDefinition } from '../types';

// Lazy-load playwright-core to handle Node.js version mismatch gracefully
export let playwrightReady = false;
let chromium: any = null;

const nodeVersion = parseInt(process.versions.node.split('.')[0], 10);
if (nodeVersion >= 20) {
  try {
    const pw = require('playwright-core');
    chromium = pw.chromium;
    playwrightReady = true;
    console.log('[Browser] playwright-core loaded successfully');
  } catch (err: any) {
    console.warn('[Browser] playwright-core unavailable:', err.message);
  }
} else {
  console.warn(`[Browser] Skipped — Node.js ${process.versions.node} detected, Playwright requires Node.js 20+`);
}

// ============================================================================
// BROWSER MANAGER (singleton, shared across tool calls)
// ============================================================================

class BrowserManager {
  private browser: any = null;
  private context: any = null;
  private page: any = null;
  private screenshotDir: string = '';

  async ensureBrowser(workspace: string): Promise<any> {
    if (!playwrightReady || !chromium) {
      throw new Error('Browser tools require Node.js 20+ and playwright-core. Current Node.js version may be too old.');
    }

    this.screenshotDir = path.join(workspace, '.michaelangelo', 'screenshots');
    fs.mkdirSync(this.screenshotDir, { recursive: true });

    if (!this.browser || !this.browser.isConnected()) {
      console.log('[Browser] Launching headless Chromium...');
      this.browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });
      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });
    }

    if (!this.page || this.page.isClosed()) {
      this.page = await this.context!.newPage();
    }

    return this.page;
  }

  async close(): Promise<void> {
    if (this.page && !this.page.isClosed()) {
      await this.page.close().catch(() => {});
    }
    if (this.context) {
      await this.context.close().catch(() => {});
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
    }
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  getPage(): any {
    return this.page;
  }

  getScreenshotDir(): string {
    return this.screenshotDir;
  }

  async getContext(): Promise<any> {
    if (!this.browser || !this.browser.isConnected()) return null;
    if (!this.context) {
      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });
    }
    return this.context;
  }
}

// Singleton instance
const browserManager = new BrowserManager();

// ============================================================================
// TOOL DEFINITIONS
// ============================================================================

const navigateToUrl: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_navigate',
    description: 'Navigate the headless browser to a URL. Use this to open localhost dev servers or any webpage for visual analysis.',
    parameters: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'The URL to navigate to (e.g., http://localhost:3000)' },
        wait_until: {
          type: 'string',
          description: 'When to consider navigation complete: "load" (default), "networkidle", "domcontentloaded"',
          enum: ['load', 'networkidle', 'domcontentloaded'],
        },
        timeout_ms: { type: 'number', description: 'Navigation timeout in milliseconds (default 30000)' },
      },
      required: ['url'],
    },
  },
};

const screenshotPage: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_screenshot',
    description: 'Take a screenshot of the current page. Returns the file path. The agent can then analyze the visual output to fix layout/CSS issues.',
    parameters: {
      type: 'object' as const,
      properties: {
        filename: { type: 'string', description: 'Filename for the screenshot (default: auto-generated)' },
        full_page: { type: 'boolean', description: 'If true, captures the full scrollable page (default: viewport only)' },
        selector: { type: 'string', description: 'CSS selector to screenshot a specific element' },
      },
      required: [],
    },
  },
};

const getPageContent: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_get_content',
    description: 'Get the text content of the current page. Useful for analyzing rendered text and structure.',
    parameters: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector to get content from a specific element' },
        max_length: { type: 'number', description: 'Maximum characters to return (default 5000)' },
      },
      required: [],
    },
  },
};

const getComputedStyles: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_get_styles',
    description: 'Get computed CSS styles for a selector. Useful for diagnosing layout issues (display, position, width, height, etc.).',
    parameters: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector of the element to inspect' },
        properties: {
          type: 'string',
          description: 'Comma-separated CSS properties to check (e.g., "display,width,height,color,font-size")',
        },
      },
      required: ['selector'],
    },
  },
};

const evaluateJs: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_evaluate',
    description: 'Evaluate JavaScript in the page context. Useful for querying DOM state, checking element counts, measuring sizes, etc.',
    parameters: {
      type: 'object' as const,
      properties: {
        expression: { type: 'string', description: 'JavaScript expression to evaluate. Must return a value.' },
      },
      required: ['expression'],
    },
  },
};

const waitForSelector: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_wait',
    description: 'Wait for a CSS selector to appear on the page. Useful for waiting for dynamic content.',
    parameters: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector to wait for' },
        timeout_ms: { type: 'number', description: 'Timeout in milliseconds (default 10000)' },
      },
      required: ['selector'],
    },
  },
};

const getConsoleLogs: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_console',
    description: 'Get browser console messages (errors, warnings, logs). Useful for debugging frontend issues.',
    parameters: {
      type: 'object' as const,
      properties: {
        level: {
          type: 'string',
          description: 'Filter by log level (default: all)',
          enum: ['error', 'warning', 'info', 'all'],
        },
      },
      required: [],
    },
  },
};

// ============================================================================
// CONSOLE LOG CAPTURE
// ============================================================================

interface ConsoleMessage {
  level: string;
  text: string;
  url?: string;
  line?: number;
}

const consoleLogs: ConsoleMessage[] = [];

function setupConsoleCapture(page: any): void {
  page.on('console', (msg: any) => {
    consoleLogs.push({
      level: msg.type(),
      text: msg.text(),
      url: msg.location()?.url,
      line: msg.location()?.lineNumber,
    });
    // Keep only last 100 messages
    if (consoleLogs.length > 100) consoleLogs.shift();
  });
}

// ============================================================================
// EXECUTE FUNCTION
// ============================================================================

async function executeBrowserTool(
  name: string,
  args: Record<string, any>,
  ctx: ExecutionContext,
): Promise<ToolResult> {
  try {
    const page = await browserManager.ensureBrowser(ctx.workspace);

    // Setup console capture on first use
    setupConsoleCapture(page);

    switch (name) {
      case 'browser_navigate': {
        const url = args.url as string;
        const waitUntil = (args.wait_until as any) || 'domcontentloaded';
        const timeout = (args.timeout_ms as number) || 30000;

        console.log(`[Browser] Navigating to: ${url}`);
        await page.goto(url, { waitUntil, timeout });

        const title = await page.title();
        const currentUrl = page.url();
        return {
          success: true,
          output: `Navigated to: ${currentUrl}\nTitle: ${title}\nURL: ${currentUrl}`,
        };
      }

      case 'browser_screenshot': {
        const dir = browserManager.getScreenshotDir();
        const filename = (args.filename as string) || `screenshot_${Date.now()}.png`;
        const fullPath = path.join(dir, filename);
        const fullPage = args.full_page as boolean;
        const selector = args.selector as string;

        if (selector) {
          const element = await page.$(selector);
          if (!element) {
            return { success: false, output: '', error: `Element not found: ${selector}` };
          }
          await element.screenshot({ path: fullPath });
        } else {
          await page.screenshot({ path: fullPath, fullPage: fullPage || false });
        }

        // Also get a base64 thumbnail for inline analysis
        const buffer = await page.screenshot({ fullPage: false });
        const base64 = buffer.toString('base64');

        return {
          success: true,
          output: `Screenshot saved: ${fullPath}\nViewport: ${page.viewportSize()?.width}x${page.viewportSize()?.height}\nPage URL: ${page.url()}\nPage title: ${await page.title()}`,
          metadata: { screenshotPath: fullPath, thumbnail: `data:image/png;base64,${base64.substring(0, 200)}...` },
        };
      }

      case 'browser_get_content': {
        const selector = args.selector as string;
        const maxLength = (args.max_length as number) || 5000;

        let content: string;
        if (selector) {
          const element = await page.$(selector);
          if (!element) {
            return { success: false, output: '', error: `Element not found: ${selector}` };
          }
          content = await element.textContent() || '';
        } else {
          content = await page.textContent('body') || '';
        }

        const truncated = content.length > maxLength
          ? content.substring(0, maxLength) + `\n\n[...truncated, ${content.length} total chars]`
          : content;

        return { success: true, output: truncated };
      }

      case 'browser_get_styles': {
        const selector = args.selector as string;
        const propsStr = (args.properties as string) || 'display,position,width,height,margin,padding,border,background,color,font-size,visibility,overflow,z-index';

        const styles = await page.evaluate(({ sel, props }: { sel: string; props: string }) => {
          const el = (globalThis as any).document.querySelector(sel);
          if (!el) return null;
          const computed = (globalThis as any).window.getComputedStyle(el);
          const result: Record<string, string> = {};
          for (const prop of props.split(',')) {
            result[prop.trim()] = computed.getPropertyValue(prop.trim());
          }
          const rect = el.getBoundingClientRect();
          result['bounding_rect'] = `${rect.x},${rect.y},${rect.width},${rect.height}`;
          return result;
        }, { sel: selector, props: propsStr });

        if (!styles) {
          return { success: false, output: '', error: `Element not found: ${selector}` };
        }

        const formatted = Object.entries(styles)
          .map(([k, v]) => `  ${k}: ${v}`)
          .join('\n');

        return { success: true, output: `Computed styles for "${selector}":\n${formatted}` };
      }

      case 'browser_evaluate': {
        const expression = args.expression as string;
        const result = await page.evaluate(expression);
        return {
          success: true,
          output: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
        };
      }

      case 'browser_wait': {
        const selector = args.selector as string;
        const timeout = (args.timeout_ms as number) || 10000;

        try {
          await page.waitForSelector(selector, { timeout });
          return { success: true, output: `Element appeared: ${selector}` };
        } catch {
          return { success: false, output: '', error: `Timeout waiting for: ${selector}` };
        }
      }

      case 'browser_console': {
        const level = (args.level as string) || 'all';
        const filtered = level === 'all'
          ? consoleLogs
          : consoleLogs.filter(m => m.level === level);

        const output = filtered.slice(-30).map(m =>
          `[${m.level}] ${m.text}`
        ).join('\n');

        return {
          success: true,
          output: output || `No ${level} console messages captured.`,
        };
      }

      case 'browser_click': {
        const selector = args.selector as string;
        if (!selector) return { success: false, output: '', error: 'selector required' };
        console.log(`[Browser] Clicking: ${selector}`);
        await page.waitForSelector(selector, { timeout: 10000 });
        await page.click(selector);
        await page.waitForTimeout(500); // wait for navigation/effects
        return { success: true, output: `Clicked: ${selector}\nURL: ${page.url()}\nTitle: ${await page.title()}` };
      }

      case 'browser_type': {
        const sel = args.selector as string;
        const text = args.text as string;
        if (!sel || !text) return { success: false, output: '', error: 'selector and text required' };
        console.log(`[Browser] Typing into: ${sel}`);
        await page.waitForSelector(sel, { timeout: 10000 });
        await page.fill(sel, text);
        return { success: true, output: `Typed ${text.length} chars into ${sel}` };
      }

      case 'browser_select': {
        const sel2 = args.selector as string;
        const value = args.value as string;
        if (!sel2 || !value) return { success: false, output: '', error: 'selector and value required' };
        await page.waitForSelector(sel2, { timeout: 10000 });
        await page.selectOption(sel2, value);
        return { success: true, output: `Selected '${value}' in ${sel2}` };
      }

      case 'browser_scroll': {
        const direction = (args.direction as string) || 'down';
        const pixels = (args.pixels as number) || 500;
        await page.evaluate(`window.scrollBy(0, ${direction === 'up' ? '-' : ''}${pixels})`);
        return { success: true, output: `Scrolled ${direction} ${pixels}px` };
      }

      case 'browser_wait_for': {
        const sel3 = args.selector as string;
        const timeout = (args.timeout_ms as number) || 10000;
        if (!sel3) return { success: false, output: '', error: 'selector required' };
        console.log(`[Browser] Waiting for: ${sel3}`);
        await page.waitForSelector(sel3, { timeout });
        return { success: true, output: `Element found: ${sel3}` };
      }

      case 'browser_fill': {
        const fillSel = args.selector as string;
        const fillVal = args.value as string;
        if (!fillSel || fillVal === undefined) return { success: false, output: '', error: 'selector and value required' };
        await page.fill(fillSel, fillVal);
        return { success: true, output: `Filled ${fillSel} with '${fillVal.substring(0, 50)}'` };
      }

      case 'browser_press': {
        const key = args.key as string;
        if (!key) return { success: false, output: '', error: 'key required (e.g., Enter, Tab, Escape, ArrowDown)' };
        await page.keyboard.press(key);
        return { success: true, output: `Pressed: ${key}` };
      }

      case 'browser_hover': {
        const hoverSel = args.selector as string;
        if (!hoverSel) return { success: false, output: '', error: 'selector required' };
        await page.hover(hoverSel);
        return { success: true, output: `Hovered: ${hoverSel}` };
      }

      case 'browser_check': {
        const checkSel = args.selector as string;
        const checked = args.checked !== false;
        if (!checkSel) return { success: false, output: '', error: 'selector required' };
        if (checked) await page.check(checkSel); else await page.uncheck(checkSel);
        return { success: true, output: `${checked ? 'Checked' : 'Unchecked'}: ${checkSel}` };
      }

      case 'browser_drag': {
        const fromSel = args.from_selector as string;
        const toSel = args.to_selector as string;
        if (!fromSel || !toSel) return { success: false, output: '', error: 'from_selector and to_selector required' };
        await page.dragAndDrop(fromSel, toSel);
        return { success: true, output: `Dragged ${fromSel} to ${toSel}` };
      }

      case 'browser_upload': {
        const uploadSel = args.selector as string;
        const filePath = args.file_path as string;
        if (!uploadSel || !filePath) return { success: false, output: '', error: 'selector and file_path required' };
        const fileInput = await page.$(uploadSel);
        if (!fileInput) return { success: false, output: '', error: `Input not found: ${uploadSel}` };
        await fileInput.setInputFiles(filePath);
        return { success: true, output: `Uploaded ${filePath} to ${uploadSel}` };
      }

      case 'browser_new_tab': {
        const url = args.url as string;
        const newPage = await browserManager.getContext().then(c => c?.newPage());
        if (newPage && url) await newPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        return { success: true, output: `New tab opened${url ? ': ' + url : ''}` };
      }

      case 'browser_switch_tab': {
        const index = (args.index as number) || 0;
        const context = await browserManager.getContext();
        if (!context) return { success: false, output: '', error: 'No browser context' };
        const pages = context.pages();
        if (index >= pages.length) return { success: false, output: '', error: `Tab ${index} not found (have ${pages.length})` };
        // Note: Playwright doesn't have a direct switchTab, but we can bring a page to front
        await pages[index].bringToFront();
        return { success: true, output: `Switched to tab ${index}: ${pages[index].url()}` };
      }

      case 'browser_list_tabs': {
        const ctx = await browserManager.getContext();
        if (!ctx) return { success: false, output: '', error: 'No browser context' };
        const tabs = ctx.pages().map((p: any, i: number) => `Tab ${i}: ${p.url()} — ${p.title()}`);
        return { success: true, output: tabs.join('\n') || 'No tabs open' };
      }

      case 'browser_go_back': {
        await page.goBack({ timeout: 10000 });
        return { success: true, output: `Back to: ${page.url()}` };
      }

      case 'browser_go_forward': {
        await page.goForward({ timeout: 10000 });
        return { success: true, output: `Forward to: ${page.url()}` };
      }

      case 'browser_reload': {
        await page.reload({ timeout: 15000 });
        return { success: true, output: `Reloaded: ${page.url()}\nTitle: ${await page.title()}` };
      }

      case 'browser_pdf': {
        const pdfPath = (args.path as string) || `screenshot_${Date.now()}.pdf`;
        const dir = browserManager.getScreenshotDir();
        const fullPath = require('path').join(dir, pdfPath);
        await page.pdf({ path: fullPath, format: 'A4' });
        return { success: true, output: `PDF saved: ${fullPath}` };
      }

      case 'browser_cookie': {
        const action = (args.action as string) || 'get';
        if (action === 'get') {
          const cookies = await page.context().cookies();
          return { success: true, output: JSON.stringify(cookies.slice(0, 20), null, 2) };
        }
        if (action === 'set' && args.name && args.value) {
          await page.context().addCookies([{ name: args.name, value: args.value, url: page.url() }]);
          return { success: true, output: `Cookie set: ${args.name}=${args.value}` };
        }
        return { success: false, output: '', error: 'action=get|set, name, value required' };
      }

      case 'browser_local_storage': {
        const lsAction = (args.action as string) || 'get';
        if (lsAction === 'get') {
          const data = await page.evaluate(() => JSON.stringify(localStorage));
          return { success: true, output: data.substring(0, 2000) };
        }
        if (lsAction === 'set' && args.key && args.value) {
          await page.evaluate(({k, v}: {k: string, v: string}) => localStorage.setItem(k, v), {k: args.key, v: args.value});
          return { success: true, output: `localStorage[${args.key}] = ${args.value}` };
        }
        if (lsAction === 'clear') {
          await page.evaluate(() => localStorage.clear());
          return { success: true, output: 'localStorage cleared' };
        }
        return { success: false, output: '', error: 'action=get|set|clear required' };
      }

      case 'browser_intercept': {
        const pattern = args.pattern as string || '*';
        const route = args.route as string || 'block';
        const context = await browserManager.getContext();
        if (!context) return { success: false, output: '', error: 'No browser context' };
        if (route === 'block') {
          await context.route(pattern, (routeObj: any) => routeObj.abort());
          return { success: true, output: `Blocking requests matching: ${pattern}` };
        }
        return { success: true, output: `Intercept pattern: ${pattern}` };
      }

      case 'browser_emulate': {
        const device = args.device as string;
        if (!device) return { success: false, output: '', error: 'device required (e.g., iPhone 14, Pixel 7)' };
        // Close current page and create new one with device settings
        const pw = require('playwright-core');
        const devices = pw.devices || {};
        const deviceInfo = devices[device];
        if (!deviceInfo) {
          const available = Object.keys(devices).slice(0, 10).join(', ');
          return { success: false, output: '', error: `Device not found: ${device}. Available: ${available}...` };
        }
        const context = await browserManager.getContext();
        if (!context) return { success: false, output: '', error: 'No browser context' };
        const emuPage = await context.newPage();
        await emuPage.setViewportSize(deviceInfo.viewport);
        return { success: true, output: `Emulating: ${device}\nViewport: ${deviceInfo.viewport.width}x${deviceInfo.viewport.height}\nUser-Agent: ${deviceInfo.userAgent.substring(0, 80)}...` };
      }

      case 'browser_auth': {
        const authAction = args.action as string;
        if (authAction === 'login' && args.url && args.username && args.password) {
          await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
          // Try common login selectors
          const usernameSelectors = ['input[name="username"]', 'input[name="email"]', 'input[type="email"]', '#username', '#email'];
          const passwordSelectors = ['input[name="password"]', 'input[type="password"]', '#password'];
          for (const sel of usernameSelectors) {
            try { await page.fill(sel, args.username); break; } catch {}
          }
          for (const sel of passwordSelectors) {
            try { await page.fill(sel, args.password); break; } catch {}
          }
          // Try to submit
          const submitSelectors = ['button[type="submit"]', 'input[type="submit"]', 'button:has-text("Login")', 'button:has-text("Sign in")'];
          for (const sel of submitSelectors) {
            try { await page.click(sel); break; } catch {}
          }
          await page.waitForTimeout(3000);
          return { success: true, output: `Logged in to: ${args.url}\nCurrent URL: ${page.url()}\nTitle: ${await page.title()}` };
        }
        if (authAction === 'save_state') {
          const statePath = require('path').join(browserManager.getScreenshotDir(), 'auth-state.json');
          const state = await page.context().storageState();
          require('fs').writeFileSync(statePath, JSON.stringify(state));
          return { success: true, output: `Auth state saved: ${statePath}` };
        }
        if (authAction === 'load_state') {
          const statePath2 = require('path').join(browserManager.getScreenshotDir(), 'auth-state.json');
          if (!require('fs').existsSync(statePath2)) return { success: false, output: '', error: 'No saved auth state found' };
          const state2 = JSON.parse(require('fs').readFileSync(statePath2, 'utf-8'));
          await page.context().addCookies(state2.cookies);
          return { success: true, output: `Auth state loaded (${state2.cookies.length} cookies)` };
        }
        return { success: false, output: '', error: 'action=login|save_state|load_state required' };
      }

      case 'browser_close': {
        await browserManager.close();
        return { success: true, output: 'Browser closed.' };
      }

      default:
        return { success: false, output: '', error: `Unknown browser tool: ${name}` };
    }
  } catch (err: any) {
    console.error(`[Browser] Tool ${name} failed:`, err.message);
    return { success: false, output: '', error: `Browser tool error: ${err.message}` };
  }
}

// ============================================================================
// SKILL EXPORT
// ============================================================================

export const BrowserSkill: AgentSkill = {
  name: 'browser',
  description: 'Headless browser tools for visual analysis of web UIs',
  tools: [navigateToUrl, screenshotPage, getPageContent, getComputedStyles, evaluateJs, waitForSelector, getConsoleLogs],
  execute: executeBrowserTool,
};

/**
 * Close the browser (call on session end or app shutdown)
 */
export async function closeBrowser(): Promise<void> {
  await browserManager.close();
}
