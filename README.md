# Meadow Bot

斜俯視角的微縮療癒場景：小機器人在紅磚牆、石板廣場與花草間漫遊。three.js + Vite，所有模型都是程式生成，音效全部用 Web Audio 即時合成。

```bash
npm install
npm run dev
```

## 操作

- WASD / 方向鍵：移動
- 點地面：前往該位置
- 閒置 4 秒：自動巡遊
- 右下角按鈕：開關聲音（瀏覽器需要先點一下才會出聲）

## 結構

| 檔案 | 內容 |
|---|---|
| `src/terrain.js` | 地形高度、草地 / 泥土路 / 乾草區 / 廣場分區 |
| `src/vegetation.js` | 草叢（InstancedMesh + 風擺 shader）、小花點與花叢、蘆葦、魯冰花、常春藤，以及由上千片葉枝組成的樹與灌木 |
| `src/bricks.js` | 圓角磚牆（沿曲線掃掠 + 程式磚紋與青苔 shader）、磚柱、整塊拱形涵洞、倒塌牆塊 |
| `src/props.js` | 長滿植物的拱門磚房（藍門、鐵欄、棚架招牌、蠟燭石台）、帶青苔與髒污的石板廣場、落葉碎石、木桶、電線桿、飼料箱、柵欄、鐵門、帆布攤位、燈串、小木屋、花圃、路障 |
| `src/animals.js` | 會吃草的牛、四處嗅聞的狐狸、會啄地亂走的雞、沿小路與廣場散步的村民 |
| `src/robot.js` | 六輪外送機器人模型、操控、巡遊路線 |
| `src/collision.js` | 2D 膠囊碰撞 |
| `src/post.js` | AO（n8ao）→ Bloom → 移軸景深 → ACES 色調映射與調色 |
| `src/weathering.js` | 共用的做舊 shader：髒污、牆腳泥垢、積灰、褪色、木紋、鏽斑，以及凹凸起伏 |
| `src/graffiti.js` | Canvas 即時繪製的噴漆塗鴉貼花：滴痕簽名（tag）與粗描邊泡泡字（piece） |
| `src/audio.js` | 風聲、樹葉、鳥叫、牛叫、雞叫、馬達聲、音樂盒旋律 |
