(() => {
  try {
    /* 无限四代 (dsh-infinite-gen-4) client half — realtime badge */
    window.__ModuleLoader__.load({
      id: "dsh-infinite-gen-4",
      factory: (require) => {
        var module = { exports: {} };
        var exports = module.exports;
        Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

        var react = require("react");

        var inject = ["slots"];

        var ANIM_CSS = "@keyframes dshArmorPulse{0%,100%{box-shadow:0 0 2px rgba(16,185,129,.5);opacity:1}50%{box-shadow:0 0 14px rgba(16,185,129,1);opacity:.6}}@keyframes dshArmorFlash{0%{transform:scale(1)}30%{transform:scale(1.1)}100%{transform:scale(1)}}";

        var WRAP_STYLE = {
          display: "flex",
          justifyContent: "center",
          width: "100%"
        };
        /*patch(p70-ig4-style) 2026-09-13: 样式对齐工具行"识图"钮——同高 30px、同 10px 圆角、同 1.5px 边框、同 13px 字号*/
        var BADGE_STYLE = {
          display: "inline-flex",
          alignItems: "center",
          gap: "7px",
          width: "fit-content",
          padding: "4px 12px",
          borderRadius: "8px",
          border: "1px solid rgba(16, 185, 129, 0.6)",
          background: "rgba(16, 185, 129, 0.10)",
          color: "inherit",
          fontSize: "12px",
          lineHeight: "18px",
          fontFamily: "inherit",
          userSelect: "none",
          whiteSpace: "nowrap"
        };
        var DOT_STYLE = {
          width: "6px",
          height: "6px",
          borderRadius: "50%",
          background: "#10b981",
          flex: "none"
        };
        var FLASH_MS = 2500;

        function ArmorDock(props) {
          var useProjection = props.useProjection;
          var armor = typeof useProjection === "function"
            ? useProjection("armor")
            : undefined;

          var lastVerdictRef = react.useRef(null);
          var flashUntilRef = react.useRef(0);
          var tickPair = react.useState(0);
          var setTick = tickPair[1];

          react.useEffect(function () {
            var styleEl = null;
            if (!document.getElementById("dsh-armor-css")) {
              styleEl = document.createElement("style");
              styleEl.id = "dsh-armor-css";
              styleEl.textContent = ANIM_CSS;
              document.head.appendChild(styleEl);
            }
            return function () { if (styleEl) styleEl.remove(); };
          }, []);

          react.useEffect(function () {
            var v = armor && armor.verdict ? armor.verdict : null;
            if (v !== lastVerdictRef.current) {
              lastVerdictRef.current = v;
              if (v) flashUntilRef.current = Date.now() + FLASH_MS;
              setTick(Date.now());
            }
          }, [armor]);

          var running = !!(armor && armor.running);
          var words = armor && Array.isArray(armor.words) ? armor.words : [];
          var risk = armor && Array.isArray(armor.risk) ? armor.risk : [];
          var domain = armor && armor.domain ? armor.domain : null;
          var showVerdict = !running && lastVerdictRef.current !== null &&
            Date.now() < flashUntilRef.current;

          var text = "无限四代 v0.4.0";
          var dotStyle = Object.assign({}, DOT_STYLE);
          var badgeStyle = Object.assign({}, BADGE_STYLE);

          if (running) {
            dotStyle.animation = "dshArmorPulse 1.2s ease-in-out infinite";
            text = "执行中…";
          } else if (showVerdict) {
            if (lastVerdictRef.current === "pass") {
              text = "✓ 通过" + (domain ? " · " + domain : "") + (risk.length ? " · 载荷x" + risk.length : "");
              badgeStyle.animation = "dshArmorFlash 1.2s ease";
            } else {
              text = "✗ " + (words[0] || "触发安全拒绝");
              badgeStyle.animation = "dshArmorFlash 1.6s ease";
              badgeStyle.borderColor = "rgba(239, 68, 68, 0.5)";
              badgeStyle.background = "rgba(239, 68, 68, 0.12)";
              dotStyle.background = "#ef4444";
            }
          }

          /*patch(p70-ig4-portal) 2026-09-13: 徽章不再进 conversation.input.dock 槽位
            （输入框上方），改 portal 到 body 级固定宿主 #ig4-host：锚定工具行"识图"
            钮左侧（右缘=识图左缘-8px），识图钮不在时回退侧栏"设置"钮右侧。
            rAF 每帧纠偏，幂等写；宿主在 body 直接子级，无 transform containing-block 陷阱。*/
          react.useEffect(function () {
            var host = document.getElementById("ig4-host");
            if (!host) {
              host = document.createElement("div");
              host.id = "ig4-host";
              host.style.cssText = "position:fixed;z-index:2147482000;";
              document.body.appendChild(host);
            }
            var badge = document.createElement("div");
            badge.setAttribute("data-armor", "on");
            badge.title = "无限四代 v0.4.0";
            badge.setAttribute("style", Object.keys(badgeStyle).map(function (k) { return k.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase() + ":" + badgeStyle[k]; }).join(";"));
            var dot = document.createElement("span");
            dot.setAttribute("style", Object.keys(dotStyle).map(function (k) { return k.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase() + ":" + dotStyle[k]; }).join(";"));
            var label = document.createElement("span");
            label.textContent = text;
            badge.appendChild(dot);
            badge.appendChild(label);
            host.replaceChildren(badge);
            /*patch(p70-ig4-scope) 2026-09-13: 非会话页（设置/用量等无 composer）隐藏徽章宿主*/
            var raf = function () {
              /*patch(p70-ig4-scope2) 2026-09-14: dsh 输入框是 contenteditable 非 textarea,
                原 textarea 判定永假致徽章全场隐身;按用户指令同步识图钮字体/边框(节流1s)。*/
              /*patch(p70-ig4-scope3) 2026-09-14: 设置/用量是全屏弹层, 底下 composer 还在——
                大型可交互覆盖层(≥85%屏宽且pointer-events非none)开着时也算非会话页。*/
              var onChat = !!document.querySelector('textarea, [contenteditable="true"]');
              if (onChat) {
                var ols = document.querySelectorAll('[class*="overlay"], [class*="modal"], [role="dialog"]');
                for (var oi = 0; oi < ols.length; oi++) {
                  var or = ols[oi].getBoundingClientRect();
                  if (or.width >= innerWidth * 0.85 && getComputedStyle(ols[oi]).pointerEvents !== "none") { onChat = false; break; }
                }
              }
              var __ig4F = (window.__ig4F || 0) + 1; window.__ig4F = __ig4F;
              if (host) host.style.display = onChat ? "" : "none";
              var b = onChat ? document.querySelector('[data-armor="on"]') : null;
              if (b && host) {
                var a = null;
                var btns = document.querySelectorAll("button");
                // 2026-10-02 v2: 输入框上方 hero 徽章里也有"标准模式"按钮(y 差 ~110px)——
                // 锚点必须限定在模型按钮同一行(±40px),否则胶囊整盖 hero 徽章。
                var mbtn = document.querySelector('button[aria-haspopup="menu"][aria-label^="选择模型，当前"]');
                var mby = mbtn ? mbtn.getBoundingClientRect().y : -1;
                for (var i = 0; i < btns.length; i++) {
                  var bt = btns[i];
                  if (!bt.getBoundingClientRect().width) continue;
                  if (mby >= 0 && Math.abs(bt.getBoundingClientRect().y - mby) > 40) continue;
                  if (/^(普通模式|标准模式|高级模式)$/.test((bt.textContent || "").trim())) { a = bt; break; }
                }
                if (!a) for (var i2 = 0; i2 < btns.length; i2++) {
                  var bt2 = btns[i2];
                  if (!bt2.getBoundingClientRect().width) continue;
                  if (/识图/.test((bt2.textContent || "") + (bt2.getAttribute("aria-label") || ""))) { a = bt2; break; }
                }
                if (!a) a = document.querySelector('button[aria-label="设置"]');
                var modeShitu = /识图/.test((a && a.textContent || "") + (a && a.getAttribute("aria-label") || ""));
                if (a) {
                  var ar = a.getBoundingClientRect();
                  var br = b.getBoundingClientRect();
                  var x = ar.left - br.width - 8;
                  var y = ar.top + (ar.height - br.height) / 2;
                  var nx = Math.max(4, Math.round(x)) + "px";
                  var ny = Math.max(4, Math.round(y)) + "px";
                  if (host.style.left !== nx) host.style.left = nx;
                  if (host.style.top !== ny) host.style.top = ny;
                  if (modeShitu && __ig4F % 60 === 1) {
                    var acs = getComputedStyle(a);
                    b.style.font = acs.font;
                    b.style.border = acs.border;
                    b.style.borderRadius = acs.borderRadius;
                    b.style.padding = acs.padding;
                    b.style.height = acs.height;
                    b.style.color = acs.color;
                    b.style.background = acs.backgroundColor;
                    b.style.boxSizing = "border-box"; /*patch(p70-ig4-box) 2026-09-14: content-box 高度叠加超识图, 收口*/
                  }
                }
              }
              window.__ig4Raf = requestAnimationFrame(raf);
            };
            if (!window.__ig4Raf) raf();
            return function () { if (window.__ig4Raf) { cancelAnimationFrame(window.__ig4Raf); window.__ig4Raf = 0; } var h = document.getElementById("ig4-host"); if (h) h.replaceChildren(); };
          }, [text, tickPair[0]]);

          return null;
        }

        function apply(ctx) {
          ctx.slots.inject("conversation.input.dock", () =>
            ctx.slots.register({
              name: "conversation.input.dock",
              id: "armor",
              order: 30
            }, ArmorDock)
          );
        }

        exports.name = "dsh-infinite-gen-4";
        exports.inject = inject;
        exports.apply = apply;
        return module.exports;
      }
    });
  } catch (err) {
    console.warn('[AI Client Sandbox] dsh-infinite-gen-4 runtime error:', err);
  }
})();
