// Watches the Alpha game as a spectator at several screen sizes.
import { boardFitsFrame, check, joinViaUi, newPlayer, shot } from './harness.mjs';

export async function layoutSuite(BASE) {
  for (const vp of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    const P = await newPlayer(`spectator-${vp.width}`, vp);
    await joinViaUi(P, BASE, 'ALPHA', 'archon');
    await P.page.getByTestId('spectator-badge').waitFor({ timeout: 10000 });
    await P.page.waitForTimeout(1600); // let the 1 s fade-in finish

    const fit = await boardFitsFrame(P.page);
    const noHScroll = await P.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    check(`${vp.width}x${vp.height}: board fully inside its frame`, fit.fits, JSON.stringify(fit));
    check(`${vp.width}x${vp.height}: no horizontal page scroll`, noHScroll);
    if (vp.width >= 1280) {
      const column = await P.page.evaluate(() => {
        const top = document.querySelector('[data-testid="player-tag-top"]').getBoundingClientRect().top;
        const bottom = document.querySelector('[data-testid="player-tag-bottom"]').getBoundingClientRect().bottom;
        return { top: Math.round(top), bottom: Math.round(bottom), height: window.innerHeight };
      });
      check(`${vp.width}x${vp.height}: both player tags and the board fit on screen`, column.top >= 0 && column.bottom <= column.height, JSON.stringify(column));
    }
    await shot(P.page, `viewport-${vp.width}`);
    await P.ctx.close();
  }
}
