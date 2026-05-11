import { Plugin } from "@utils/pluginBase";
import { getPrefixes } from "@utils/pluginManager";
import os from "os";
import path from "path";
import fs from "fs/promises";
import { SendLogDB } from "@utils/sendLogDB";
import { Api } from "teleproto";

const prefixes = getPrefixes();
const mainPrefix = prefixes[0];

async function findLogFiles(): Promise<{
  outLog: string | null;
  errLog: string | null;
}> {
  const possiblePaths = [
    path.join(os.homedir(), ".pm2/logs/telebox-out.log"),
    path.join(os.homedir(), ".pm2/logs/telebox-error.log"),
    path.join(os.homedir(), ".pm2/logs/telebox-err.log"),
    path.join(process.cwd(), "logs/out.log"),
    path.join(process.cwd(), "logs/error.log"),
    path.join(process.cwd(), "logs/telebox.log"),
    "/var/log/telebox/out.log",
    "/var/log/telebox/error.log",
    "./logs/out.log",
    "./logs/error.log",
  ];

  let outLog: string | null = null;
  let errLog: string | null = null;

  for (const logPath of possiblePaths) {
    try {
      await fs.access(logPath);
      const fileName = path.basename(logPath).toLowerCase();

      if (fileName.includes("out") && !outLog) {
        outLog = logPath;
      } else if (
        (fileName.includes("err") || fileName.includes("error")) &&
        !errLog
      ) {
        errLog = logPath;
      }
    } catch {
      // 文件不存在，继续检查下一个
    }
  }

  return { outLog, errLog };
}

const fn = async (msg: Api.Message) => {
  console.log("SendLog plugin triggered");

  const parts = msg.message.trim().split(/\s+/).filter(Boolean);
  console.log("SendLog parts:", parts);

  const subCommand = parts[1];

  // 处理 help 子命令
  if (subCommand === "help") {
    const helpText = `<b>📋 日志管理插件</b>\n\n<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n<b>📤 发送日志文件</b>\n<code>.sendlog</code>\n\n<b>🎯 设置发送目标</b>\n<code>.sendlog set &lt;目标&gt;</code>\n• <code>me</code> — 已保存消息 <i>(默认)</i>\n• <code>123456789</code> — 用户ID\n• <code>@username</code> — 用户名\n\n<b>🗑️ 清理日志文件</b>\n<code>.sendlog clean</code>\n\n<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n<b>📌 示例</b>\n<pre>.sendlog set me\n.sendlog clean\n.sendlog</pre>\n\n<i>⚠️ 日志文件超过 50MB 将自动跳过</i>`;
    
    await msg.edit({ 
      text: helpText, 
      parse_mode: 'HTML' 
    });
    return;
  }

  // 处理 set 子命令：设置日志发送目标
  if (subCommand === "set") {
    const target = parts[2];
    if (!target) {
      await msg.edit({ text: `用法: ${mainPrefix}sendlog set <chatId|me|@username>` });
      return;
    }
    const db = new SendLogDB();
    db.setTarget(target);
    db.close();
    await msg.edit({ text: `✅ 已设置日志发送目标` });
    return;
  }

  // 处理 clean 子命令：清理日志文件
  if (subCommand === "clean") {
    await msg.edit({ text: `🔍 正在搜索日志文件...` });

    const { outLog, errLog } = await findLogFiles();
    console.log("Found logs for cleaning:", { outLog, errLog });

    if (!outLog && !errLog) {
      await msg.edit({
        text: "❌ 未找到日志文件\n\n已检查路径:\n• ~/.pm2/logs/telebox-*.log\n• ./logs/*.log\n• /var/log/telebox/*.log",
      });
      return;
    }

    const results: string[] = [];
    let cleanedCount = 0;

    if (outLog) {
      try {
        const stats = await fs.stat(outLog);
        const sizeKB = Math.round(stats.size / 1024);
        await fs.unlink(outLog);
        results.push(`✅ 已删除输出日志 (${sizeKB}KB)`);
        cleanedCount++;
      } catch (error: any) {
        results.push(`❌ 删除输出日志失败: ${error.message?.substring(0, 50) || "未知错误"}`);
      }
    }

    if (errLog) {
      try {
        const stats = await fs.stat(errLog);
        const sizeKB = Math.round(stats.size / 1024);
        await fs.unlink(errLog);
        results.push(`✅ 已删除错误日志 (${sizeKB}KB)`);
        cleanedCount++;
      } catch (error: any) {
        results.push(`❌ 删除错误日志失败: ${error.message?.substring(0, 50) || "未知错误"}`);
      }
    }

    const summaryText = [
      cleanedCount > 0 ? "🗑️ 日志清理完成" : "⚠️ 日志清理失败",
      "",
      ...results,
      "",
      cleanedCount > 0 ? `📊 已清理 ${cleanedCount} 个日志文件` : "💡 建议检查日志文件路径和权限",
    ].join("\n");

    await msg.edit({ text: summaryText });
    return;
  }

  // 默认行为：无子命令时发送日志文件
  let target: string | number = "me";
  const db = new SendLogDB();
  const savedTarget = db.getTarget();
  db.close();
  
  // 验证目标有效性
  if (savedTarget) {
    target = savedTarget;
  }

  try {
    await msg.edit({ text: `🔍 正在搜索日志文件...` });

    const { outLog, errLog } = await findLogFiles();
    console.log("Found logs:", { outLog, errLog });

    if (!outLog && !errLog) {
      await msg.edit({
        text: "❌ 未找到日志文件\n\n已检查路径:\n• ~/.pm2/logs/telebox-*.log\n• ./logs/*.log\n• /var/log/telebox/*.log\n\n建议:\n• 检查PM2进程状态\n• 确认日志文件路径",
      });
      return;
    }

    let sentCount = 0;
    const results: string[] = [];

    if (outLog) {
      try {
        const stats = await fs.stat(outLog);
        const sizeKB = Math.round(stats.size / 1024);
        console.log(`Sending output log: ${outLog} (${sizeKB}KB) to ${target}`);

        if (stats.size > 50 * 1024 * 1024) {
          results.push(`⚠️ 输出日志过大 (${sizeKB}KB)，已跳过`);
        } else {
          await msg.client?.sendFile(target, {
            file: outLog,
            caption: `📄 输出日志 (${sizeKB}KB)\n📁 ${outLog}`,
          });
          results.push(`✅ 输出日志已发送 (${sizeKB}KB)`);
          sentCount++;
        }
      } catch (error: any) {
        console.error("Error sending output log:", error);
        results.push(
          `❌ 输出日志发送失败: ${error.message?.substring(0, 50) || "未知错误"}`
        );
      }
    }

    if (errLog) {
      try {
        const stats = await fs.stat(errLog);
        const sizeKB = Math.round(stats.size / 1024);
        console.log(`Sending error log: ${errLog} (${sizeKB}KB) to ${target}`);

        if (stats.size > 50 * 1024 * 1024) {
          results.push(`⚠️ 错误日志过大 (${sizeKB}KB)，已跳过`);
        } else {
          await msg.client?.sendFile(target, {
            file: errLog,
            caption: `🚨 错误日志 (${sizeKB}KB)\n📁 ${errLog}`,
          });
          results.push(`✅ 错误日志已发送 (${sizeKB}KB)`);
          sentCount++;
        }
      } catch (error: any) {
        console.error("Error sending error log:", error);
        results.push(
          `❌ 错误日志发送失败: ${error.message?.substring(0, 50) || "未知错误"}`
        );
      }
    }

    const summaryText = [
      sentCount > 0 ? "📋 日志发送完成" : "⚠️ 日志发送失败",
      "",
      ...results,
      "",
      sentCount > 0 ? `📱 日志文件已发送` : "💡 建议检查日志文件路径和权限",
    ].join("\n");

    await msg.edit({ text: summaryText });
  } catch (error: any) {
    console.error("SendLog plugin error:", error);
    const errorMsg =
      error.message?.length > 100
        ? error.message.substring(0, 100) + "..."
        : error.message;
    await msg.edit({
      text: `❌ 日志发送失败\n\n错误信息: ${errorMsg || "未知错误"}\n\n可能的解决方案:\n• 检查文件权限\n• 确认PM2进程状态\n• 重启telebox服务`,
    });
  }
};

class SendLogPlugin extends Plugin {
  description: string = `<b>📋 日志管理插件</b>\n\n<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n<b>📤 发送日志文件</b>\n<code>.sendlog</code>\n\n<b>🎯 设置发送目标</b>\n<code>.sendlog set &lt;目标&gt;</code>\n• <code>me</code> — 已保存消息 <i>(默认)</i>\n• <code>123456789</code> — 用户ID\n• <code>@username</code> — 用户名\n\n<b>🗑️ 清理日志文件</b>\n<code>.sendlog clean</code>\n\n<b>━━━━━━━━━━━━━━━━━━━━</b>\n\n<b>📌 示例</b>\n<pre>.sendlog set me\n.sendlog clean\n.sendlog</pre>\n\n<i>⚠️ 日志文件超过 50MB 将自动跳过</i>`;

  cmdHandlers: Record<string, (msg: Api.Message) => Promise<void>> = {
    sendlog: fn,
    logs: fn,
    log: fn,
  };
}

export default new SendLogPlugin();  for (const logPath of possiblePaths) {
    try {
      await fs.access(logPath);
      const fileName = path.basename(logPath).toLowerCase();

      if (fileName.includes("out") && !outLog) {
        outLog = logPath;
      } else if (
        (fileName.includes("err") || fileName.includes("error")) &&
        !errLog
      ) {
        errLog = logPath;
      }
    } catch {
      // 文件不存在，继续检查下一个
    }
  }

  return { outLog, errLog };
}

function htmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const fn = async (msg: Api.Message) => {
  console.log("SendLog plugin triggered");

  const parts = msg.message.trim().split(/\s+/).filter(Boolean);
  console.log("SendLog parts:", parts);

  // 修复：正确提取子命令 parts[0]是命令本身(如.sendlog)，parts[1]才是子命令(如set/clean)
  const subCommand = parts[1];

  // 处理 set 子命令：设置日志发送目标
  if (subCommand === "set") {
    const target = parts[2];
    if (!target) {
      await msg.edit({ text: `用法: ${mainPrefix}sendlog set &lt;chatId|me&gt;` });
      return;
    }
    const db = new SendLogDB();
    db.setTarget(target);
    db.close();
    // 不暴露具体目标
    await msg.edit({ text: `✅ 已设置日志发送目标` });
    return;
  }

  // 处理 clean 子命令：清理日志文件
  if (subCommand === "clean") {
    await msg.edit({ text: `🔍 正在搜索日志文件...` });

    const { outLog, errLog } = await findLogFiles();
    console.log("Found logs for cleaning:", { outLog, errLog });

    if (!outLog && !errLog) {
      await msg.edit({
        text: "❌ 未找到日志文件\n\n已检查路径:\n• ~/.pm2/logs/telebox-*.log\n• ./logs/*.log\n• /var/log/telebox/*.log",
      });
      return;
    }

    const results: string[] = [];
    let cleanedCount = 0;

    if (outLog) {
      try {
        const stats = await fs.stat(outLog);
        const sizeKB = Math.round(stats.size / 1024);
        await fs.unlink(outLog);
        results.push(`✅ 已删除输出日志 (${sizeKB}KB)`);
        cleanedCount++;
      } catch (error: any) {
        results.push(`❌ 删除输出日志失败: ${error.message?.substring(0, 50) || "未知错误"}`);
      }
    }

    if (errLog) {
      try {
        const stats = await fs.stat(errLog);
        const sizeKB = Math.round(stats.size / 1024);
        await fs.unlink(errLog);
        results.push(`✅ 已删除错误日志 (${sizeKB}KB)`);
        cleanedCount++;
      } catch (error: any) {
        results.push(`❌ 删除错误日志失败: ${error.message?.substring(0, 50) || "未知错误"}`);
      }
    }

    const summaryText = [
      cleanedCount > 0 ? "🗑️ 日志清理完成" : "⚠️ 日志清理失败",
      "",
      ...results,
      "",
      cleanedCount > 0 ? `📊 已清理 ${cleanedCount} 个日志文件` : "💡 建议检查日志文件路径和权限",
    ].join("\n");

    await msg.edit({ text: summaryText });
    return;
  }

  // 默认行为：无子命令时发送日志文件
  let target: string | number = "me";
  const db = new SendLogDB();
  target = db.getTarget();
  db.close();

  try {
    // 初始响应不显示目标
    await msg.edit({ text: `🔍 正在搜索日志文件...` });

    const { outLog, errLog } = await findLogFiles();
    console.log("Found logs:", { outLog, errLog });

    if (!outLog && !errLog) {
      await msg.edit({
        text: "❌ 未找到日志文件\n\n已检查路径:\n• ~/.pm2/logs/telebox-*.log\n• ./logs/*.log\n• /var/log/telebox/*.log\n\n建议:\n• 检查PM2进程状态\n• 确认日志文件路径",
      });
      return;
    }

    let sentCount = 0;
    const results: string[] = [];

    // 发送输出日志
    if (outLog) {
      try {
        const stats = await fs.stat(outLog);
        const sizeKB = Math.round(stats.size / 1024);
        console.log(`Sending output log: ${outLog} (${sizeKB}KB) to ${target}`);

        if (stats.size > 50 * 1024 * 1024) {
          results.push(`⚠️ 输出日志过大 (${sizeKB}KB)，已跳过`);
        } else {
          await msg.client?.sendFile(target, {
            file: outLog,
            caption: `📄 输出日志 (${sizeKB}KB)\n📁 ${outLog}`,
          });
          results.push(`✅ 输出日志已发送 (${sizeKB}KB)`);
          sentCount++;
        }
      } catch (error: any) {
        console.error("Error sending output log:", error);
        results.push(
          `❌ 输出日志发送失败: ${
            error.message?.substring(0, 50) || "未知错误"
          }`
        );
      }
    }

    // 发送错误日志
    if (errLog) {
      try {
        const stats = await fs.stat(errLog);
        const sizeKB = Math.round(stats.size / 1024);
        console.log(`Sending error log: ${errLog} (${sizeKB}KB) to ${target}`);

        if (stats.size > 50 * 1024 * 1024) {
          results.push(`⚠️ 错误日志过大 (${sizeKB}KB)，已跳过`);
        } else {
          await msg.client?.sendFile(target, {
            file: errLog,
            caption: `🚨 错误日志 (${sizeKB}KB)\n📁 ${errLog}`,
          });
          results.push(`✅ 错误日志已发送 (${sizeKB}KB)`);
          sentCount++;
        }
      } catch (error: any) {
        console.error("Error sending error log:", error);
        results.push(
          `❌ 错误日志发送失败: ${
            error.message?.substring(0, 50) || "未知错误"
          }`
        );
      }
    }

    const summaryText = [
      sentCount > 0 ? "📋 日志发送完成" : "⚠️ 日志发送失败",
      "",
      ...results,
      "",
      sentCount > 0 ? `📱 日志文件已发送` : "💡 建议检查日志文件路径和权限",
    ].join("\n");

    await msg.edit({ text: summaryText });
  } catch (error: any) {
    console.error("SendLog plugin error:", error);
    const errorMsg =
      error.message?.length > 100
        ? error.message.substring(0, 100) + "..."
        : error.message;
    await msg.edit({
      text: `❌ 日志发送失败\n\n错误信息: ${
        errorMsg || "未知错误"
      }\n\n可能的解决方案:\n• 检查文件权限\n• 确认PM2进程状态\n• 重启telebox服务`,
    });
  }
};

class SendLogPlugin extends Plugin {

  description: string = `发送日志文件到收藏夹或自定义目标\n.sendlog set &lt;对话 ID|@用户名|me&gt; 设置发送目标 (默认 me)\n.sendlog clean 清理日志文件`;
  cmdHandlers: Record<string, (msg: Api.Message) => Promise<void>> = {
    sendlog: fn,
    logs: fn,
    log: fn,
  };
}

export default new SendLogPlugin();
