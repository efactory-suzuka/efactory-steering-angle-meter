import {describe,it,expect} from 'vitest';
import app from '../../src/app.ts?raw';
import guide from '../../guide.html?raw';
import viteConfig from '../../vite.config.ts?raw';
import manifest from '../../public/manifest.webmanifest?raw';

const pagesUrl='https://efactory-suzuka.github.io/efactory-steering-angle-meter/';

describe('public guide page',()=>{
  it('is a direct Vite multi-page entry with a base-safe public URL',()=>{
    expect(viteConfig).toContain("guide: 'guide.html'");
    expect(guide).toContain('<title>eFactory Steering Angle Measure | 使い方・仕組み</title>');
    const guideUrl=new URL('./guide.html',pagesUrl);
    expect(guideUrl.pathname).toBe('/efactory-steering-angle-meter/guide.html');
  });

  it('the measurement screen has a quiet guide link and keeps the dynamic primary instruction',()=>{
    expect(app).toContain('class="guide-link" href="'+'$'+'{import.meta.env.BASE_URL}guide.html">使い方・仕組み →</a>');
    expect(app).not.toContain('今やること');
    expect(app).toContain('id="primary-instruction" role="status"');
    expect(app).toContain("setText('status-label',guide.title)");
    expect(app).toContain("setText('status-text',guide.help)");
    expect(app).toContain('guide=view.primaryInstruction');
  });

  it('measurement and guide links stay in the same PWA scope and return to the exact base path',()=>{
    const guideUrl=new URL('./guide.html',pagesUrl);
    const returnUrl=new URL('./',guideUrl);
    const pwa=JSON.parse(manifest);
    const scope=new URL(pwa.scope,pagesUrl+'manifest.webmanifest');
    expect(returnUrl.href).toBe(pagesUrl);
    expect(scope.href).toBe(pagesUrl);
    expect(guideUrl.origin).toBe(new URL(pagesUrl).origin);
    const backLinks=guide.match(/<a class="guide-back(?: [^"]*)?"[^>]*>/g)??[];
    expect(backLinks).toHaveLength(2);
    expect(backLinks.join('')).not.toContain('target=');
    expect(guide).not.toContain('?debug=1');
  });

  it('puts beginner steps before the technical explanation',()=>{
    expect(guide.indexOf('id="steps"')).toBeLessThan(guide.indexOf('id="how-it-works"'));
    for(const phrase of ['端末を固定する','中央を記録する','左右へゆっくり動かす','いっぱいまで切って保持する']){
      expect(guide).toContain(phrase);
    }
  });

  it('explains valid and invalid mounts, including the front fender and free orientation',()=>{
    for(const phrase of ['ハンドル','トップブリッジ','フロントフォーク','フロントフェンダー','タンク','フレーム','シート','向きは自由']){
      expect(guide).toContain(phrase);
    }
    expect(guide).toContain('ステアリングと一緒に回る場所ならOK');
  });

  it('explains steering-axis estimation and the difference from a plain angle meter',()=>{
    for(const phrase of ['端末の傾きを測っているだけではありません','一般的な角度計','3次元の動き','ステアリング回転軸を推定','回転を測定']){
      expect(guide).toContain(phrase);
    }
    expect(guide).toContain('回転軸を調べる理由');
  });

  it('describes MAX timing, quality behavior, and calculation example for users',()=>{
    for(const phrase of ['0.7秒安定','Lock-to-Lock','少し不安定','MAXの記録だけを一時停止','中央の再記録','LEFT MAX','RIGHT MAX']){
      expect(guide).toContain(phrase);
    }
  });

  it('states beta status and display resolution without an accuracy claim',()=>{
    expect(guide).toContain('β版へのご協力');
    expect(guide).toContain('0.1°は表示単位であり、測定精度を保証するものではありません。');
    for(const phrase of ['±0.1°精度','0.1°精度保証','0.1°の正確さ','高精度を保証','どんな車両でも正確']){
      expect(guide).not.toContain(phrase);
    }
  });

  it('uses local brand artwork and provides no debug navigation or fixed-height measurement styles',()=>{
    expect(guide).toContain('src="%BASE_URL%efactory-e-icon.png"');
    expect(guide).toContain('src="%BASE_URL%efactory-wordmark-black.png"');
    expect(guide).toContain('Developed by eFactory');
    expect(guide).toContain('https://efactorysuzuka.wixsite.com/efactory');
    expect(guide).not.toContain('debug=');
    expect(guide).toContain('<link rel="stylesheet" href="/src/ui/guide.css">');
  });
});
