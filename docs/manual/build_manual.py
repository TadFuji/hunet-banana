"""Build the illustrated Japanese user manual. No API credentials are used."""
from pathlib import Path
from io import BytesIO
from html import escape
import json
from PIL import Image
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor, Color
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Paragraph, Table, TableStyle
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.pagesizes import A4

ROOT = Path(__file__).resolve().parent
OUT = ROOT.parent.parent / 'output' / 'pdf'
OUT.mkdir(parents=True, exist_ok=True)
PDF = OUT / 'Banana_Studio_図解取扱説明書.pdf'
pdfmetrics.registerFont(TTFont('JP', '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'))
pdfmetrics.registerFontFamily('JP', normal='JP', bold='JP', italic='JP', boldItalic='JP')
W, H = A4
M = 36
CW = W - 2 * M
INK = '#24312E'; MUTED = '#61716B'; GREEN = '#386255'; AMBER = '#C58626'
PAPER = '#FBFAF6'; PALE = '#EDF3ED'; GOLD = '#FBF0D8'; LINE = '#D6DED7'
c = canvas.Canvas(str(PDF), pagesize=A4, pageCompression=1)
c.setTitle('Banana Studio 図解取扱説明書 - Photoshopユーザー向け')
c.setAuthor('Banana Studio')
c.setSubject('APIキーの取得・課金・画像生成・部分編集・安全な保存と終了')
page_no = 0
records = []
sources = {
    '料金': 'https://ai.google.dev/gemini-api/docs/pricing#gemini-nano-banana-2.1',
    'APIキー': 'https://ai.google.dev/gemini-api/docs/api-key',
    '課金': 'https://ai.google.dev/gemini-api/docs/billing',
    '支出上限': 'https://ai.google.dev/gemini-api/docs/billing#project-spend-caps',
    '予算アラート': 'https://docs.cloud.google.com/billing/docs/how-to/budgets',
    'キー制限': 'https://docs.cloud.google.com/docs/authentication/api-keys#add_application_restrictions',
    'モデル': 'https://ai.google.dev/gemini-api/docs/models/gemini-nano-banana-2.1',
    'Batch': 'https://ai.google.dev/gemini-api/docs/batch-api',
    '利用条件': 'https://ai.google.dev/gemini-api/terms',
}

def rect(x, top, w, h, fill=PAPER, stroke=None, radius=8):
    c.setFillColor(HexColor(fill))
    c.setStrokeColor(HexColor(stroke or fill))
    c.roundRect(x, H-top-h, w, h, radius, stroke=bool(stroke), fill=1)

def para(text, top, x=M, w=CW, size=11, leading=None, color=INK, align=0):
    st = ParagraphStyle('body', fontName='JP', fontSize=size, leading=leading or size*1.5,
                        textColor=HexColor(color), wordWrap='CJK', alignment=align,
                        splitLongWords=True, spaceAfter=0, allowWidows=0, allowOrphans=0)
    p = Paragraph(text, st)
    _, ht = p.wrap(w, H)
    p.drawOn(c, x, H-top-ht)
    records.append({'page':page_no, 'top':round(top,2), 'bottom':round(top+ht,2), 'text':text})
    if top+ht > 790:
        raise ValueError(f'Page {page_no} overflow: {top+ht:.1f}: {text[:80]}')
    return top+ht

def label(text, x, top, size=9, color=MUTED, font='JP'):
    c.setFillColor(HexColor(color)); c.setFont(font, size); c.drawString(x, H-top-size, text)

def num(n, x, top, r=11):
    c.setFillColor(HexColor(AMBER)); c.circle(x, H-top, r, stroke=0, fill=1)
    c.setFont('Helvetica-Bold', 11); c.setFillColor(HexColor('#FFFFFF'))
    c.drawCentredString(x, H-top-3.7, str(n))

def step(n, title, text, top, x=M, w=CW):
    num(n, x+11, top+11)
    end = para(title, top-1, x=x+32, w=w-32, size=12, color=GREEN)
    end = para(text, end+4, x=x+32, w=w-32, size=10.5)
    return end+17

def note(title, text, top, x=M, w=CW, kind='tip'):
    fill = GOLD if kind=='warn' else PALE
    st = ParagraphStyle('measure',fontName='JP',fontSize=10.5,leading=15.5,wordWrap='CJK')
    p = Paragraph(text,st); _,hh=p.wrap(w-28,H)
    ht = hh+47
    rect(x,top,w,ht,fill)
    para(title,top+12,x+14,w-28,11.5,color=AMBER if kind=='warn' else GREEN)
    para(text,top+33,x+14,w-28,10.5,15.5)
    return top+ht+14

def pic(name, top, x=M, w=CW, crop=None, caption=None):
    im = Image.open(ROOT/'images'/f'{name}.png').convert('RGB')
    if crop: im = im.crop(crop)
    ht = w*im.height/im.width
    c.drawImage(ImageReader(im),x,H-top-ht,w,ht,mask='auto')
    c.setStrokeColor(HexColor(LINE)); c.setLineWidth(.6); c.rect(x,H-top-ht,w,ht,stroke=1,fill=0)
    if top+ht > 790: raise ValueError(f'Image overflow page {page_no}: {name} {top+ht:.1f}')
    if caption: return para(caption,top+ht+7,x,w,8.5,12,color=MUTED)+10
    return top+ht

def table(headers, rows, widths, top, x=M, size=10):
    def cell(t,header=False):
        return Paragraph(str(t),ParagraphStyle('cell',fontName='JP',fontSize=size,
                         leading=size*1.45,wordWrap='CJK',textColor=HexColor('#FFFFFF' if header else INK)))
    data=[[cell(t,True) for t in headers]]+[[cell(t) for t in row] for row in rows]
    t=Table(data,colWidths=widths,hAlign='LEFT')
    t.setStyle(TableStyle([
        ('BACKGROUND',(0,0),(-1,0),HexColor(GREEN)),
        ('VALIGN',(0,0),(-1,-1),'TOP'),
        ('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),
        ('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10),
        ('ROWBACKGROUNDS',(0,1),(-1,-1),[HexColor('#FFFFFF'),HexColor('#F0F3EE')]),
        ('LINEBELOW',(0,0),(-1,-1),.4,HexColor(LINE)),
    ]))
    _,ht=t.wrap(CW,H); t.drawOn(c,x,H-top-ht)
    if top+ht>790: raise ValueError(f'Table overflow page {page_no}: {top+ht}')
    records.append({'page':page_no,'top':top,'bottom':top+ht,'text':str(headers)+str(rows)})
    return top+ht+15

def footer():
    c.setStrokeColor(HexColor(LINE));c.setLineWidth(.6);c.line(M,39,W-M,39)
    label('Banana Studio  /  図解取扱説明書  /  2026.10.13',M,H-29,8)
    c.setFillColor(HexColor(MUTED));c.setFont('Helvetica',9);c.drawRightString(W-M,18,f'{page_no:02d} / 22')

def page(title, category, lead):
    global page_no
    if page_no: footer(); c.showPage()
    page_no+=1
    c.setFillColor(HexColor(PAPER)); c.rect(0,0,W,H,fill=1,stroke=0)
    c.bookmarkPage(f'p{page_no}');c.addOutlineEntry(title,f'p{page_no}',level=0,closed=False)
    label('BANANA STUDIO',M,28,9,GREEN,'Helvetica-Bold')
    label(category,W-195,28,9,AMBER)
    para(title,57,size=23,leading=30)
    para(lead,99,size=10.5,leading=15.5,color=MUTED)

def source_note(keys,top=767):
    text='公式資料：'+' / '.join(f'<link href="{sources[k]}" color="{GREEN}">{k}</link>' for k in keys)
    para(text,top,size=8.5,leading=12,color=MUTED)

def arrow(x1,y1,x2,y2,color=AMBER):
    c.setStrokeColor(HexColor(color));c.setLineWidth(1.8);c.line(x1,H-y1,x2,H-y2)
    import math
    a=math.atan2(y2-y1,x2-x1)
    for b in [a+.5,a-.5]:c.line(x2,H-y2,x2-7*math.cos(b),H-y2+7*math.sin(b))

def flow_card(x,top,w,h,title,text):
    rect(x,top,w,h,PALE,LINE)
    para(title,top+13,x+13,w-26,12,color=GREEN)
    para(text,top+40,x+13,w-26,10,15)

# 01 -------------------------------------------------------------------------
page('画像づくりを、いつもの感覚で。','USER GUIDE / 第1版',
     'Photoshopに慣れた方のための、画像でわかる取扱説明書')
label('Banana Studio',M,151,35,INK,'Helvetica-Bold')
para('Nano Banana 2.1 を使った<br/>画像生成・編集のはじめ方',205,size=22,leading=32)
end=pic('overview',290,x=M+(CW-500)/2,w=500,caption='実際のアプリ画面。中央の画像はアプリに付属するローカルのサンプルです。')
note('この1冊でできること','自分のAPIキーを用意する → 1枚生成する → 選んだ場所を編集する → 保存する。料金・安全な終了・困ったときの対処まで、順番に説明します。',end+9)
para('対象：Macのデスクトップブラウザ / アプリ第1版<br/>公式情報の確認日：2026年10月13日',754,size=9,leading=14,color=MUTED)

# 02 -------------------------------------------------------------------------
page('はじめに、この順番で進めましょう','START HERE',
     'プログラミングの知識は不要です。最初は「新規生成」で1枚だけ試します。')
y=147
for n,title,text in [
 (1,'アプリを開く','このMacでは「Banana Studioを起動.command」をダブルクリックします。すでに起動中なら http://127.0.0.1:4173/ を開きます。'),
 (2,'自分のAPIキーと課金設定を用意する','Google AI Studioで設定します。キーの取得は5ページ、課金設定は6ページです。'),
 (3,'アプリにキーを設定する','右上の「APIキーを設定」から貼り付けます。設定するだけでは画像生成を実行しません。'),
 (4,'画像を生成して、確認してから採用する','「新規生成」、1K、検索オフから始めます。PNGと編集用プロジェクトを保存して終了します。'),
]:y=step(n,title,text,y)
rect(M,y+1,CW,204,'#FFFFFF',LINE)
para('目的から探す',y+15,x=M+15,w=CW-30,size=13,color=GREEN)
items=[('画面の見方','03'),('APIキーとは・取得・設定','04 - 07'),('生成・全体編集・部分編集','08 - 10'),('スケッチ・レイヤー・詳細設定','11 - 13'),('保存・Batch・安全な終了','14 - 16'),('料金・支出管理','17 - 19'),('困ったとき・早見表・資料','20 - 22')]
yy=y+43
for title,pn in items:
    para(title,yy,x=M+15,w=400,size=10,leading=15)
    label(pn,W-M-75,yy,10,GREEN,'Helvetica');yy+=21
note('キーなしでも練習できます','画像を開く、選択する、レイヤーを動かす、文字を入れる、保存する操作には、Gemini APIの利用料金はかかりません。',y+219)

# 03 -------------------------------------------------------------------------
page('Photoshopに近い、5つの場所','WORKSPACE',
     '操作は「左で道具を選ぶ → 中央で操作する → 右で調整する」が基本です。')
pic('overview',146,w=CW)
for n,xx,yy in [(1,126,158),(2,45,218),(3,281,327),(4,490,201),(5,215,470)]:num(n,xx,yy)
y=517
for n,title,text in [
 (1,'メニューと保存ボタン','画像を開く・保存・書き出し。右上にAPIキーの設定があります。'),
 (2,'左のツールバー','移動、選択ブラシ、選択消去、矩形、スケッチ、文字を選びます。'),
 (3,'中央のキャンバス','画像を表示する場所です。Spaceを押しながらドラッグすると表示を移動できます。'),
 (4,'右のパネル','AI生成・レイヤー・履歴を切り替えます。AIの指示はここに入力します。'),
 (5,'下の編集履歴','以前の状態に戻せます。取り消しは⌘Z、やり直しは⇧⌘Zです。'),
]:
    num(n,M+9,y+8,9);para(title,y-1,M+28,180,10.5,color=GREEN)
    para(text,y-1,M+210,CW-210,9.5,14);y+=48

# 04 -------------------------------------------------------------------------
page('APIキーは「自分専用の利用の鍵」です','API KEY / 基礎',
     '難しい設定用語を覚える必要はありません。まずは、役割を知っておきましょう。')
flow_card(M,157,155,143,'あなたのブラウザ','画像と文章を用意。<br/>自分のキーを設定。<br/>「画像を生成」を押す。')
flow_card(M+184,157,155,143,'Googleの画像生成','キーで利用者を確認。<br/>Nano Banana 2.1が<br/>画像を作ります。')
flow_card(M+368,157,155,143,'あなたの作品','候補を確認して採用。<br/>PNGやプロジェクト<br/>として保存します。')
arrow(M+156,228,M+180,228);arrow(M+340,228,M+364,228)
para('料金は、キーに結び付いたGoogleのプロジェクトへ',333,size=15,color=GREEN)
para('APIは「このアプリからGoogleに画像生成をお願いする仕組み」です。APIキーは、そのお願いに添える秘密の文字列。Googleアカウントのログインパスワードとは別物です。',366,size=11)
y=table(['言葉','ここでは、こう考えてください'],[
 ['APIキー','自分専用の利用の鍵。人に渡さず、アプリの専用欄にだけ入力します。'],
 ['プロジェクト','Google側で、キー・利用量・料金をまとめる管理単位です。'],
 ['請求先アカウント','支払方法と請求を管理する場所。キーのプロジェクトと紐付けます。'],
 ['プロンプト','AIに伝える文章の指示。日本語で入力できます。'],
], [118,CW-118],443)
note('Photoshopの契約とは別の料金です','Adobeの契約にGemini APIの利用料が含まれるという意味ではありません。Nano Banana 2.1のAPIには無料枠がなく、Google側の有料設定が必要です。',y,kind='warn')
source_note(['APIキー','課金','料金'])

# 05 -------------------------------------------------------------------------
page('Google AI Studioで、自分のキーを用意する','API KEY / 取得',
     'Googleアカウントを使います。自分のアカウントで、公式サイトを開いてください。')
rect(M,145,CW,53,PALE)
para('<link href="https://aistudio.google.com/apikey" color="'+GREEN+'">https://aistudio.google.com/apikey</link>',158,x=M+14,w=CW-28,size=12)
para('クリックで公式のキー管理画面を開けます。',179,x=M+14,w=CW-28,size=8.5,color=MUTED)
y=221
for n,title,text in [
 (1,'Googleアカウントでログイン','表示された利用条件を確認します。会社のアカウントでは、組織の利用方針や権限も確認してください。'),
 (2,'プロジェクトを確認する','初めての利用者には、既定のプロジェクトとキーが自動作成される場合があります。すでにある方は、それを確認して先へ進めます。'),
 (3,'必要なら「Create API key」で作成','キー名を「Banana Studio専用」などにし、使うプロジェクトを選びます。他のサービスで使うキーとの共用は避けます。'),
 (4,'キーをコピーする','キーの値をコピーして、7ページのアプリの入力欄に貼り付けます。チャットやメール、共有資料には貼らないでください。'),
]:y=step(n,title,text,y)
label('Google画面で探す言葉の説明図（実際の画面写真ではありません）',M,y,8.5)
flow_card(M,y+22,155,100,'Dashboard','管理画面を開く')
flow_card(M+184,y+22,155,100,'API Keys','キーの一覧を開く')
flow_card(M+368,y+22,155,100,'Create API key','必要な場合に作成')
arrow(M+156,y+72,M+180,y+72);arrow(M+340,y+72,M+364,y+72)
note('以前からGoogle Cloudを使っている方へ','プロジェクトが出ない場合は Dashboard → Projects → Import projects で取り込みます。作成ボタンが使えない場合は管理者への権限確認が必要です。',y+140)
source_note(['APIキー'])

# 06 -------------------------------------------------------------------------
page('画像生成を使うための、課金設定','BILLING / 初回だけ',
     'キーの作成と、画像生成を使える課金状態にすることは、別の手順です。')
flow_card(M,153,155,101,'キーのプロジェクト','どのプロジェクトの<br/>キーを使うか確認')
flow_card(M+184,153,155,101,'Set up billing','請求先・連絡先・<br/>支払方法を設定')
flow_card(M+368,153,155,101,'Billingで確認','利用できる状態か<br/>残高・プランを確認')
arrow(M+156,206,M+180,206);arrow(M+340,206,M+364,206)
y=282
for n,title,text in [
 (1,'対象の「Set up billing」を押す','Google AI StudioのAPI KeysまたはProjectsで、使うキーと同じプロジェクトの課金設定へ進みます。'),
 (2,'請求先と支払方法を確認する','初めてなら国・連絡先・支払方法を設定します。請求先がすでにある方は、使うものを選びます。支払情報はGoogleの画面に入力します。'),
 (3,'画面に表示された支払プランを確認する','Prepayは前払い、Postpayは後払いです。新規利用者は通常Prepayで、最低US$5相当の事前購入が求められます。アカウントによって画面は異なります。'),
 (4,'Billingで状態を確認してアプリへ戻る','前払いなら残高が必要です。「No credits」は残高や前払い設定の確認が必要という表示です。自動補充は任意なので、オンにする前に内容を確認します。'),
]:y=step(n,title,text,y)
note('US$5は「1枚の料金」ではありません','前払いの残高を購入する金額です。1枚ごとの出力料金は17ページに掲載しています。購入条件・税・通貨はGoogleの支払画面が優先されます。',y,kind='warn')
source_note(['課金','料金'])

# 07 -------------------------------------------------------------------------
page('コピーしたキーを、このタブに設定する','API KEY / アプリに入力',
     '右上の「APIキーを設定」を押すと、下の入力画面が開きます。')
pic('key-dialog',154,w=295)
num(1,68,338);num(2,68,382)
step(1,'専用欄に貼り付ける','「Gemini APIキー」の欄をクリックし、⌘Vで貼り付けます。文字は伏せて表示されます。',159,x=M+318,w=CW-318)
step(2,'設定ボタンを押す','「このタブに設定する」を押すと入力画面が閉じます。右上が「キー接続中」になります。',325,x=M+318,w=CW-318)
y=pic('top-actions',479,w=CW,caption='ボタンの位置。接続前は右端に「APIキーを設定」が表示されます。')
y=note('「キー接続中」は、設定できたという表示です','この時点ではGoogle側の有効性や課金状態を検証していません。最初の1枚の生成で、実際に使えるかを確認します。設定するだけでは画像生成は実行しません。',y+10)
note('毎回、必要になったら入力します','タブを閉じる・再読み込みする・15分操作しない・切断する、のいずれかでキーは破棄されます。ブラウザの「パスワードを保存」は使わないでください。',y)
para('掲載画面は説明用です。撮影には実際のAPIキーを使用していません。',750,size=8.5,color=MUTED)

# 08 -------------------------------------------------------------------------
page('まずは「新規生成」で1枚作る','GENERATE / 基本',
     '文章から新しい画像を作ります。最初は1K・検索オフで試しましょう。')
pic('generate-panel',150,w=234,crop=(0,0,515,1230))
num(1,51,251);num(2,51,338);num(3,51,414);num(4,51,676)
y=153
for n,title,text in [
 (1,'「新規生成」を選ぶ','起動直後は「部分編集」が選ばれています。文章だけで試すときは、必ず「新規生成」に切り替えます。'),
 (2,'日本語で指示を書く','被写体、背景、光、仕上がり、入れたくないものを具体的に書きます。'),
 (3,'解像度と比率を選ぶ','まずは1K。商品写真なら4:3、SNSの正方形なら1:1など、用途に合う比率にします。検索はオフのまま。'),
 (4,'「画像を生成」を押す','ここで指示と素材をGoogleへ送信します。待っている間は重ねて押さず、候補の表示を待ちます。'),
]:y=step(n,title,text,y,x=M+256,w=CW-256)
note('そのまま使える指示の例','「クリーム色の香水ボトルの商品写真。背景は深い緑。柔らかな自然光、余白を多く、文字やロゴは入れない。」',y,x=M+256,w=CW-256)
para('1K / 2K / 4Kは生成画像の解像度です。キャンバスのズーム倍率とは別です。',742,size=9,color=MUTED)

# 09 -------------------------------------------------------------------------
page('候補を確認して、採用する','RESULT / 全体編集',
     'AIの結果は、確認画面を経てからキャンバスに反映します。')
pic('candidate',147,w=332)
num(1,72,398);num(2,310,398)
step(1,'採用しない場合','「破棄」か右上の×で候補を閉じます。キャンバスは採用前のままです。生成済みの利用料が返金される操作ではありません。',160,x=M+352,w=CW-352)
step(2,'使う場合','「キャンバスに採用」を押します。AIの結果が新しいレイヤーになり、以前のレイヤーは非表示になります。',336,x=M+352,w=CW-352)
para('候補画面の画像は説明用サンプルです。実際のAPI生成ではありません。',424,size=8.5,color=MUTED)
para('すでにある画像を編集するときは「全体編集」',460,size=15,color=GREEN)
y=step(1,'画像を開いて、全体編集を選ぶ','ファイル → 画像を開く。PNG・JPEG・WebPが使えます。右の「全体編集」を選びます。',494)
y=step(2,'変えたいことと、保ちたいことを伝える','例：「背景を明るいベージュに変更。ボトルの形と位置、ラベルの文字はできるだけ保ってください。」',y)
y=step(3,'生成 → 確認 → 採用','全体編集は画像全体をAIに編集させます。保ちたいところも変わる場合があるため、細部を確認してください。',y)
note('一部だけを変えたい場合は、次の「部分編集」へ','候補生成中にキャンバスを編集すると、採用時に確認が出ます。迷ったら候補を破棄し、現在の画像でやり直してください。',y)

# 10 -------------------------------------------------------------------------
page('選んだ場所だけを変える「部分編集」','MASK / 選択範囲',
     '選択ブラシや矩形で、変えたい場所を赤く塗ります。赤い場所が編集対象です。')
pic('mask-canvas',147,w=CW,caption='実際に選択した画面。赤い表示は、完成画像に入れる色ではありません。')
y=497
for n,title,text in [
 (1,'範囲を選ぶ','左の選択ブラシ（B）で塗るか、矩形選択（M）でドラッグ。はみ出した選択は「選択を消す」（E）で消します。'),
 (2,'変え方を指示する','例：「選択したラベルだけを白い無地に変更。ボトルの形と背景は保ってください。」右のモードは「部分編集」です。'),
 (3,'生成して、採用後の境界を確認する','候補はAIの画像全体です。採用時にアプリが選択範囲だけを合成します。範囲外は元画像の画素を保持します。'),
]:y=step(n,title,text,y)
note('自然な境界になるよう、少し余裕をもって選びます','選択の境界をまたぐ大きな変更は継ぎ目が出ることがあります。元に戻して選び直します。比率は元画像に近いものへ自動設定されます。',y)

# 11 -------------------------------------------------------------------------
page('手描きで位置を伝える「スケッチ」','SKETCH / 描いて伝える',
     'ラフな線で「どこに・何を置くか」を伝えます。上手な絵である必要はありません。')
pic('sketch-canvas',149,w=CW,caption='左下のオレンジ色の線で、置きたい小物の位置を示しています。')
y=499
for n,title,text in [
 (1,'左の「スケッチ」を選ぶ','キャンバスに線を描きます。線の太さはキャンバス上部のブラシサイズで調整できます。'),
 (2,'線の意味を文章で補足する','例：「手描きの線の位置に、小さな観葉植物を置いてください。オレンジ色の線は完成画像に残さないでください。」'),
 (3,'生成して、候補を確認する','線はAIへの指示として使います。スケッチモードには、部分編集と同じ範囲外の画素保持はありません。'),
]:y=step(n,title,text,y)
note('描き直すときは、⌘Z','スケッチの線を消す専用ツールはありません。「選択を消す」は選択範囲用です。線を描き直すときは元に戻すか、履歴から描画前へ戻ります。',y)

# 12 -------------------------------------------------------------------------
page('レイヤーと文字は、慣れた考え方で','LAYERS / ローカル編集',
     '右の「レイヤー」を選びます。上の行ほど、画像の前面に表示されます。')
pic('layers',151,w=307,crop=(0,0,515,408))
num(1,65,247);num(2,297,260);num(3,207,338)
y=155
for n,title,text in [
 (1,'目のアイコン','表示・非表示を切り替えます。AI採用後、元画像を見たいときはAIレイヤーを隠し、元画像を表示します。'),
 (2,'上下の矢印','レイヤーの前後を変えます。移動するレイヤーの行を選択し、Vで画像をドラッグできます。'),
 (3,'不透明度','選択したレイヤーの濃さを調整します。ゴミ箱は選択中のレイヤーを削除します。'),
]:y=step(n,title,text,y,x=M+327,w=CW-327)
y=note('画像レイヤーを追加する','「画像レイヤーを追加」でファイルを選ぶと、現在のキャンバス内に収まる大きさで中央に配置します。自由変形・回転・描画モードは未実装です。',492)
para('文字を入れる',y+8,size=15,color=GREEN)
y=step(1,'Tを押して、文字を置く場所をクリック','入力ダイアログに文字を入れて確定します。文字が新しい画像レイヤーとして追加されます。',y+43)
note('文字はラスタライズされます','Photoshopの編集可能な文字レイヤーとは異なり、追加後の文字内容・書体・色は編集できません。修正するときは、そのレイヤーを削除して作り直します。',y,kind='warn')

# 13 -------------------------------------------------------------------------
page('参照素材と、生成の細かな設定','SETTINGS / 使い分け',
     '試作は軽く、仕上げは必要な品質で。参照素材は「見本」としてAIに渡します。')
pic('references',147,w=233,crop=(0,540,515,1155))
num(1,55,201);num(2,55,310);num(3,55,423)
y=153
for n,title,text in [
 (1,'解像度とアスペクト比','1Kで試作し、必要なら2K・4Kへ。横長は16:9、正方形は1:1など。生成の比率とキャンバスサイズは別の設定です。'),
 (2,'思考レベルと検索','minimal・medium・highを選べます。Web検索・画像検索は必要なときだけオンにします。検索や思考には追加料金があり得ます。'),
 (3,'参照素材を追加','画像・PDF・動画を選択します。「添付した画像の素材感を参考に」など、どの要素を使うか文章で説明します。'),
]:y=step(n,title,text,y,x=M+253,w=CW-253)
y=table(['素材','このアプリでの制限'],[
 ['画像','PNG・JPEG・WebP。編集元・注釈・会話履歴の画像を含め、APIへの画像入力は合計14枚まで。'],
 ['PDF・動画','PDF / MP4 / WebM / MOV。1ファイル14MiB以下。長い動画や大きいPDFは短く・小さくします。'],
 ['送信全体','送信データは19MB以下。ファイルの合計が小さくても、送信用の変換で大きくなる場合があります。'],
], [109,CW-109],570,size=9.5)
para('追加した参照素材はプロジェクトファイルには保存されません。再開時は添付し直します。',y,size=9,color=MUTED)

# 14 -------------------------------------------------------------------------
page('完成画像と、編集用データを保存する','SAVE / PNGとプロジェクト',
     '「PNG」は完成画像。「プロジェクト」は後から編集を続けるためのデータです。')
pic('file-menu',147,w=210)
para('ファイルメニューの3つの保存',151,x=M+235,w=CW-235,size=14,color=GREEN)
y=table(['操作','何が保存される？'],[
 ['保存 / ⌘S','このブラウザ内に、プロジェクト1件を保存します。自動保存ではありません。'],
 ['PNGを書き出す','表示中のレイヤーを合成した画像。レイヤーを分けて編集する情報は残りません。'],
 ['プロジェクトを<br/>書き出す','画像レイヤーとキャンバス情報を、独自の .nbstudio.json ファイルに保存します。PSDではありません。'],
], [110,CW-235-110],188,x=M+235,size=9.5)
y=step(1,'終了前は、2種類を書き出す','「PNGを書き出す」で完成画像を保存。続いて「プロジェクトを書き出す」で編集用データを保存すると安心です。',486)
y=step(2,'再開は「プロジェクトを開く」','ファイル → プロジェクトを開く、または上部の「読込」からJSONを選びます。同じブラウザに保存した1件は、再起動時に自動で復元されます。',y)
y=note('プロジェクトに保存しないもの','APIキー、選択範囲、スケッチ、Undo履歴、会話履歴、追加の参照PDF・動画は保存しません。画像は含まれるため、共有するときは内容を確認してください。',y)
para('ブラウザデータを削除したり、別ブラウザで開いたりすると、ブラウザ内保存を引き継げません。JSONファイルを手元に残してください。',y,size=9.5)

# 15 -------------------------------------------------------------------------
page('待てる制作には「Batch生成」','BATCH / まとめて生成',
     '複数の指示をまとめてGoogleに依頼する機能です。画像出力単価は通常生成の半額です。')
pic('batch',149,w=256)
y=151
for n,title,text in [
 (1,'1行に1つの指示を書く','「Batch生成」を開きます。1行ごとに独立した新規生成の指示を入力します。最大20件です。'),
 (2,'「Batchを開始」を押す','Google側にジョブを作成します。表示されたBatch IDを控えます。検索と参照素材はBatchでは使いません。'),
 (3,'あとで「更新」で確認','通常生成と違い、すぐの完成は保証されません。キーを再設定し、必要なら既存のBatch IDを読込して更新します。'),
 (4,'結果の画像を採用する','完成したサムネイルを確認し、「採用」でキャンバスに反映します。採用したらPNGとプロジェクトを保存します。'),
]:y=step(n,title,text,y,x=M+278,w=CW-278)
y=note('タブを閉じても、Google側の処理は続きます','このアプリは最後のBatch IDと状態だけを保存します。次のジョブを作る前に、必要なIDを別途控えてください。自動的に状態を更新する機能はありません。',607)
note('「中止」は中止要求です','処理の即時停止・料金の取消を保証しません。大量の4K結果は受信上限で取得できない場合があるので、最初は少ない件数で試します。',y,kind='warn')
source_note(['Batch','料金'])

# 16 -------------------------------------------------------------------------
page('使い終わったら、保存して切断する','SECURITY / 終了の手順',
     'キーは他の人へ渡さず、自分の信頼できる端末で使ってください。')
pic('key-connected',150,w=284)
step(1,'作品を保存する','PNGと編集用プロジェクトを書き出します。未保存の状態でタブを閉じないようにします。',159,x=M+306,w=CW-306)
step(2,'キーを切断する','右上の「キー接続中」を押し、「キーを破棄して切断」を押します。右上が「APIキーを設定」に戻れば完了です。',330,x=M+306,w=CW-306)
y=note('キーを切断しても、Googleのキー自体は有効です','切断はこのタブからキーを破棄する操作です。Google側のキーを無効化することや、Batchを中止すること、送信済み素材を削除することとは別です。',471)
y=note('普段の取り扱い','キーをチャット・メール・スクリーンショットに載せない。パスワード保存は使わない。共有端末で作業したら切断する。不要なブラウザ拡張を有効にしたまま使わない。',y)
para('漏洩が疑われるとき',y+4,size=13,color=GREEN)
para('アプリの使用を止め、Google AI Studioでキーを失効・交換し、利用量と請求を確認してください。アプリから切断するだけでは、不正利用を止められません。',y+32,size=10.5)
para('このアプリの保護は、端末の侵害や配布コードの改ざんまで含めた「漏洩ゼロ」を保証するものではありません。',746,size=8.5,color=MUTED)

# 17 -------------------------------------------------------------------------
page('画像生成はいくら？ 1枚と100枚の目安','PRICE / 画像出力分',
     'Nano Banana 2.1の公式単価。入力・思考・検索などは、この表に含みません。')
rect(M,149,CW,62,PALE)
para('通常生成・1Kなら、画像出力分は約5円 / 枚',162,x=M+14,w=CW-28,size=17,color=GREEN)
para('円換算は 1 USドル = 150円 の仮定。税・実際の適用為替は含みません。',191,x=M+14,w=CW-28,size=9,color=MUTED)
y=table(['解像度','通常生成 / 枚','Batch / 枚'],[
 ['1K','$0.0336<br/>約5.04円','$0.0168<br/>約2.52円'],
 ['2K','$0.0504<br/>約7.56円','$0.0252<br/>約3.78円'],
 ['4K','$0.1134*<br/>約17.01円','$0.0567<br/>約8.51円'],
], [87,(CW-87)/2,(CW-87)/2],239,size=11)
para('100枚作った場合（画像出力分だけ）',y+7,size=14,color=GREEN)
y=table(['解像度','通常生成 / 100枚','Batch / 100枚'],[
 ['1K','$3.36 / 約504円','$1.68 / 約252円'],
 ['2K','$5.04 / 約756円','$2.52 / 約378円'],
 ['4K','$11.34 / 約1,701円','$5.67 / 約851円'],
], [87,(CW-87)/2,(CW-87)/2],y+43,size=10.5)
y=note('「採用しなかった画像」も生成済みです','候補を破棄する・Undoで戻す・保存しない、という操作で生成料金が取り消されるわけではありません。画像を作り直すたびに追加の利用が発生します。',y,kind='warn')
para('*4Kは公式表では丸めて$0.113と表示。同ページの3,780出力トークン × $30 / 100万トークンで計算した$0.1134を掲載しています。確認日：2026年10月13日。',y,size=8.5,leading=12,color=MUTED)
source_note(['料金'])

# 18 -------------------------------------------------------------------------
page('画像以外にかかる料金も知っておく','PRICE / 追加の利用分',
     '実際の請求は「画像出力 + 指示や素材の入力 + 思考や文章 + 検索」などの合計です。')
flow_card(M,149,155,92,'画像の出力','解像度に応じた料金<br/>17ページの表')
flow_card(M+184,149,155,92,'指示・素材・思考','文章や画像の情報量<br/>に応じた料金')
flow_card(M+368,149,155,92,'必要なら検索','Web・画像検索が<br/>追加で発生')
label('+',M+163,182,18,AMBER,'Helvetica-Bold');label('+',M+347,182,18,AMBER,'Helvetica-Bold')
y=table(['課金対象','通常生成','Batch'],[
 ['入力<br/>文章・画像・動画など','$1.50 / 100万トークン','$0.75 / 100万トークン'],
 ['テキスト・思考の出力','$7.50 / 100万トークン','$3.75 / 100万トークン'],
 ['画像の出力','$30 / 100万トークン','$15 / 100万トークン'],
], [175,(CW-175)/2,(CW-175)/2],273,size=10)
para('トークン = Googleが情報量を数える単位',y+4,size=13,color=GREEN)
para('文字数や画像の枚数と、そのまま同じにはなりません。参照素材や編集の会話履歴を送ると、その入力も利用量に含まれます。',y+34,size=10.5)
y=note('検索の料金','Web・画像検索は、Gemini 3以降のモデルで月5,000検索の無料分を共有します。超過は$14 / 1,000検索。1回の生成で複数検索が行われることがあります。このアプリのBatchでは検索を使いません。',y+86)
y=note('最初は、1K・少ない素材・検索オフ','必要な部分だけを具体的に指示し、仕上げが決まってから解像度を上げます。思考レベルを上げる場合も、追加の利用が発生し得ることを確認してください。',y)
para('このアプリの画面に表示する「画像出力の目安」は、総請求額・残高・支出上限を表すものではありません。実際の金額はGoogleの管理画面で確認します。',y,size=9.5)
source_note(['料金'])

# 19 -------------------------------------------------------------------------
page('料金を確認し、使いすぎを防ぐ','SPEND / 利用量の管理',
     '実際の請求・残高は、キーを作ったGoogleのプロジェクトで確認します。')
label('Googleの管理画面で探す場所（説明図）',M,145,8.5)
flow_card(M,166,155,112,'Usage','利用量を見る。<br/>Dashboard → Usage')
flow_card(M+184,166,155,112,'Billing','残高・支払プラン・<br/>支払方法を見る。')
flow_card(M+368,166,155,112,'Spend','プロジェクトの<br/>支出上限を確認。')
y=table(['機能','できること','注意点'],[
 ['予算アラート','設定額に近づいたときに<br/>通知する','通知だけで自動停止を<br/>保証するものではない'],
 ['Project spend cap','AI Studioの月間支出上限<br/>Spend → Monthly spend cap','実験的機能。約10分の<br/>遅延・Batch等の超過あり'],
 ['Prepay残高','前払い残高から利用分を<br/>差し引く','自動補充の設定と、<br/>反映遅延による超過に注意'],
], [121,203,CW-324],312,size=9.5)
y=step(1,'同じプロジェクトを選んで確認','キーが複数ある場合も、同じプロジェクトの利用は合算されます。ほかのアプリで使うキーの料金も含まれ得ます。',y+10)
y=step(2,'上限と通知を設定し、利用後に見直す','少ない回数で試し、Googleの金額表示を確認します。表示の反映に時間がかかるので、短時間で大量に生成しないようにします。',y)
note('「設定した金額を絶対に超えない」とは限りません','Batchなどの処理や、課金データの反映遅延によって超過が発生し得ます。このアプリ自体には、Googleの料金を監視して止める機能はありません。',y,kind='warn')
source_note(['課金','支出上限','予算アラート'])

# 20 -------------------------------------------------------------------------
page('困ったときは、ここから確認する','HELP / よくある質問',
     'エラーが出ても、すぐに何度も生成を押さず、原因を一つずつ確認します。')
y=table(['症状','確認すること'],[
 ['「編集範囲を描いてください」','「部分編集」が選ばれています。BかMで選択するか、文章だけで生成するなら「新規生成」に切り替えます。'],
 ['「スケッチツールで線を描いてください」','スケッチモードです。左のスケッチツールで線を描くか、使いたいモードに切り替えます。'],
 ['キー接続中なのに生成できない','キーの値、Google側のプロジェクト・権限・課金・残高・制限を確認。接続中はキーの有効性を保証する表示ではありません。'],
 ['「利用枠またはレート制限」','Googleの割り当て・利用量を確認。時間を置き、連続した大量生成を控えます。'],
 ['通信が中断・失敗する','ネット接続とGoogle側の状態を確認。結果が不明なままの再試行は、追加の利用が発生する場合があります。'],
 ['素材が大きすぎる・送れない','1ファイル14MiB以下へ。画像の枚数や動画の長さを減らします。送信全体にも上限があります。'],
 ['部分編集の候補を採用できない','AIが異なる縦横比を返した可能性があります。範囲と指示を見直し、必要なら候補を破棄してやり直します。'],
 ['キーが消えた・設定ボタンに戻った','再読み込み・タブ終了・15分無操作などでキーを破棄します。必要になったら入力し直します。'],
 ['保存した作品が見つからない','同じブラウザ・同じURLで開いているか確認。ブラウザデータを消した場合は、書き出したJSONを読み込みます。'],
], [159,CW-159],145,size=9.5)
note('開発サーバーではAPIキーを接続できません','起動ファイルで開いた本番用サーバーを使ってください。現在の案内URLは http://127.0.0.1:4173/ です。起動にはNode.js 22.12以降が必要です。',y)

# 21 -------------------------------------------------------------------------
page('ショートカットと、Photoshopとの違い','QUICK REFERENCE',
     'このページは、作業中に見返す早見表として使えます。')
y=table(['キー','操作','キー','操作'],[
 ['V','レイヤー移動','B','選択ブラシ'],['E','選択を消す','M','矩形選択'],
 ['T','文字を追加','Space + ドラッグ','画面の表示位置を移動'],
 ['⌘Z','元に戻す','⇧⌘Z','やり直す'],['⌘S','ブラウザ内保存','⌘+ / ⌘-','ズーム'],
 ['[ / ]','ブラシの太さ','表示メニュー','100%表示'],
], [77,158,118,CW-353],146,size=10)
para('Windowsでは⌘をCtrlに読み替えます。文字の入力中など、ショートカットが働かない場面があります。',y,size=9.5)
y=table(['項目','このアプリの仕様'],[
 ['PSD・色管理','PSDの読み書き、CMYK、調整レイヤー、描画モードには対応していません。PNGは完成画像、JSONは独自の編集用データです。'],
 ['選択とスケッチ','選択ブラシは画像に色を塗るブラシではありません。赤い選択は部分編集用、オレンジの線はAIへの位置指示です。'],
 ['文字・レイヤー','文字は画像レイヤーになります。移動はできますが、自由変形や回転は未実装です。'],
 ['履歴・保存','Undo/Redoは最大24ステップ。選択・スケッチ・履歴はプロジェクト書き出しには含めません。'],
 ['文書の大きさ','最大40レイヤー、各辺16,384px・3,200万画素以下。全レイヤー合計1億2800万画素まで。新規文書と拡張は各辺8,192pxまで。'],
], [112,CW-112],y+40,size=9.5)
note('キャンバスを広げる','画像 → キャンバスを拡張。横幅 × 縦幅を入力し、元画像の周囲に透明な余白を増やします。余白のAI生成は別の操作です。',y)

# 22 -------------------------------------------------------------------------
page('公式資料と、この説明書の確認範囲','REFERENCES / 奥付',
     '料金・Google側の画面は変更されるため、設定時には公式ページの最新表示も確認します。')
para('公式ページ（クリックして開けます）',146,size=14,color=GREEN)
y=180
for k,explain in [
 ('料金','モデル別のStandard / Batch / 検索の単価'),('APIキー','キーの作成・管理・失効・交換'),
 ('課金','前払い・後払い・残高と利用量の確認'),('支出上限','実験的なプロジェクト上限と超過条件'),
 ('予算アラート','通知設定と、自動停止との違い'),('キー制限','Auth keyなど、キー種別ごとの制限'),
 ('Batch','まとめて生成する処理の特徴'),('モデル','Nano Banana 2.1の仕様'),('利用条件','Google側のデータ・サービス利用条件'),
]:
    para(f'{k} / {explain}',y,size=10,color=GREEN)
    y=para(f'<link href="{sources[k]}" color="{MUTED}">{escape(sources[k])}</link>',y+17,size=7.8,leading=11.2)+13
y=note('掲載画像について','アプリ画面は隔離したブラウザで撮影しました。ダミーキーと説明用の応答を使い、Googleへの実API生成は行っていません。Googleの設定手順の図は説明図で、実際の管理画面の写真ではありません。',y)
para('キーの設定・生成・採用などはアプリ実装と照合しています。実際のキーによる生成・実請求・各Googleプロジェクトの権限や通信制限は未検証です。現在の配布はローカル版で、一般公開URLはありません。',y,size=9.5,leading=14)
para('新規のAI Studioキーは通常Auth keyです。HTTPリファラー制限を設定する手順は案内していません。Auth keyの通信元制限はIPアドレスのみで、localhostや127.0.0.1は設定対象ではありません。専門的な制限設定は管理者に確認してください。',y+66,size=9,leading=13)
para('作成：Banana Studio / 第1版 / 2026年10月13日<br/>円換算：参考として1 USドル = 150円を使用（実勢レートではありません）',754,size=8.5,leading=12,color=MUTED)

assert page_no == 22
footer();c.save()
(ROOT/'layout-check.json').write_text(json.dumps(records,ensure_ascii=False,indent=2))
print(f'Created {PDF} ({page_no} pages, {PDF.stat().st_size:,} bytes)')
