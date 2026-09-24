async function testCrawler() {
  const shortcode = "C-1w-2wO3dF";
  const url = "https://www.instagram.com/reel/" + shortcode + "/";
  const userAgents = [
    { name: "Googlebot", ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" },
    { name: "Twitterbot", ua: "Twitterbot/1.0" },
    { name: "TelegramBot", ua: "TelegramBot (like TwitterBot)" },
    { name: "WhatsApp", ua: "WhatsApp/2.21.12.21 A" },
    { name: "Discordbot", ua: "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)" },
    { name: "Bingbot", ua: "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)" }
  ];
  for (const bot of userAgents) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": bot.ua } });
      const html = await res.text();
      const hasMp4 = html.includes(".mp4");
      const hasVideo = html.includes("video_url") || html.includes("<video");
      console.log(bot.name, "status:", res.status, "len:", html.length, "hasMp4:", hasMp4, "hasVideo:", hasVideo);
      if (hasMp4) {
        const mp4Match = html.match(/(https:\/\/[^"'\s\\]+\.mp4[^"'\s\\]*)/);
        if (mp4Match) console.log(bot.name, "Found MP4:", mp4Match[1].substring(0, 100));
      }
    } catch (e) {
      console.log(bot.name, "error:", e.message);
    }
  }
}
testCrawler();
