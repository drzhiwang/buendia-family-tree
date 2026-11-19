(() => {
  'use strict';
  const data = window.MACONDO;
  const timeline = window.MACONDO_TIMELINE;
  const events = new Map(timeline.events.map(event=>[event.id,event]));
  const eventsByPerson = new Map(data.people.map(p=>[p.id,timeline.events.filter(event=>event.personIds.includes(p.id))]));
  const $ = (s) => document.querySelector(s);
  const svgNS = 'http://www.w3.org/2000/svg';
  const chart = $('#chart'), world = $('#world'), panel = $('#detail-panel');
  const people = new Map(data.people.map(p => [p.id, p]));
  const geometry=window.buildMacondoLayout(data);
  const nodes = new Map(), drawnEdges = [], drawnJunctions=[];
  const enabled = new Set(['parentage', 'marriage', 'partner']);
  const filterCategory=relation=>['blood','adopt'].includes(relation.type)?'parentage':relation.type;
  const W = data.cardWidth, H = data.cardHeight;
  const failedPortraits = new Set();
  const fallbackSrc = p => p.group ? 'assets/portraits/group.svg' : 'assets/portraits/silhouette.svg';
  const portraitSrc = p => failedPortraits.has(p.id) ? fallbackSrc(p) : p.portrait.src;
  const portraitLabel = p => failedPortraits.has(p.id) ? '图片暂不可用 · 剪影' : p.portrait.kind === 'still' ? `Netflix 剧照 · ${p.portrait.stage}` : p.group ? '十七子 · 合并条目' : '暂无可核实剧照';
  const READING_SCALE=.8;
  const view = {x:0, y:0, scale:READING_SCALE};
  let viewMode='initial',generationFocus=null;
  let selected = null, moved = false, searchIndex = -1;
  let selectedEvent = null, timelineFilter = null, detailPerson = null;
  let drag=null;
  const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const proseHTML = value => String(value).split(/\n\s*\n/).map(paragraph=>`<p>${esc(paragraph)}</p>`).join('');
  const genName = n => `第${['','一','二','三','四','五','六','七'][n]}代`;
  function portraitHTML(p, className) {
    return `<img class="${className}" data-portrait-id="${esc(p.id)}" src="${esc(portraitSrc(p))}" alt="" width="384" height="480" decoding="async">`;
  }
  function portraitFailed(id) {
    if (failedPortraits.has(id) || !people.has(id)) return;
    failedPortraits.add(id);
    const p = people.get(id);
    document.querySelectorAll(`[data-portrait-id="${id}"]`).forEach(image => {
      if (image.namespaceURI === svgNS) image.setAttribute('href',fallbackSrc(p));
      else image.src = fallbackSrc(p);
    });
    document.querySelectorAll(`[data-portrait-note="${id}"]`).forEach(el => {el.textContent=portraitLabel(p);});
  }
  // Capture image errors for both SVG cards and dynamically inserted HTML details/results.
  document.addEventListener('error',e=>{
    const id=e.target?.getAttribute?.('data-portrait-id');
    if (id) portraitFailed(id);
  },true);
  function svg(tag, attrs = {}, parent, text) {
    const el = document.createElementNS(svgNS, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    if (text !== undefined) el.textContent = text;
    if (parent) parent.append(el);
    return el;
  }
  const allRelations=geometry.relations;
  const junctionLayer=svg('g',{'id':'connection-junctions'},$('#connections'));
  const relationshipLabelLayer=svg('g',{'id':'relationship-labels'},$('#connections'));
  const relationshipLabels=[];
  for (const gen of geometry.generationGuides) {
    svg('line', {x1:35, x2:data.width-30, y1:gen.guideY, y2:gen.guideY, class:'gen-guide'}, $('#generation-guides'));
    svg('text', {x:gen.labelX, y:gen.labelY, class:'gen-label'}, $('#generation-guides'), `${String(gen.number).padStart(2,'0')}  ${gen.title}`);
    const button = document.createElement('button');
    button.textContent = String(gen.number).padStart(2,'0');
    button.title = genName(gen.number);
    button.setAttribute('aria-label', `定位${genName(gen.number)}`);
    button.dataset.generation = gen.number;
    button.addEventListener('click', () => goGeneration(gen.number));
    $('.generation-nav').append(button);
  }
  for(const spec of geometry.paths) {
    const element=svg('g',{'class':'connection-group','data-route':spec.id},$('#connections'));
    svg('path',{d:spec.d,class:'connection-halo','stroke-width':spec.type==='marriage'?13:8},element);
    const paths=[svg('path',{d:spec.d,class:`connection ${spec.type}`,'data-edge':spec.id,...(spec.type==='marriage'?{transform:'translate(0 -3)'}:{})},element)];
    if(spec.type==='marriage')paths.push(svg('path',{d:spec.d,class:'connection marriage',transform:'translate(0 3)','data-edge':spec.id+'-parallel'},element));
    drawnEdges.push({...spec,element,paths});
  }
  for(const spec of geometry.junctions) {
    const element=svg('circle',{cx:spec.point[0],cy:spec.point[1],r:4,class:`connection-junction ${spec.type}`,'data-junction':spec.id},junctionLayer);
    drawnJunctions.push({...spec,element});
  }
  $('#connections').append(junctionLayer);
  for(const spec of geometry.labels) {
    const element=svg('g',{'class':'relationship-label','data-relationship-label':spec.text},relationshipLabelLayer);
    if(spec.anchor)svg('line',{x1:spec.anchor[0],y1:spec.anchor[1],x2:spec.leaderEnd[0],y2:spec.leaderEnd[1],class:'relationship-label-leader'},element);
    svg('rect',{x:spec.x,y:spec.y,width:spec.width,height:spec.height,rx:4,class:'relationship-label-bg'},element);
    svg('text',{x:spec.x+spec.width/2,y:spec.y+spec.height/2+6,'text-anchor':'middle',class:'relationship-label-text'},element,spec.text);
    relationshipLabels.push({...spec,element});
  }
  for (const p of data.people) {
    const group = svg('g', {class:`person-node${p.generation === null ? ' external' : ''}${p.group ? ' group' : ''}`, transform:`translate(${p.x} ${p.y})`, role:'button', tabindex:'0', 'aria-label':`${p.name}，${p.generation ? genName(p.generation) : '关联人物'}，${p.caption}`, 'aria-pressed':'false', 'data-person':p.id}, $('#people'));
    svg('title', {}, group, `${p.name} / ${p.original}`);
    svg('rect', {width:W,height:H,rx:7,class:'card'}, group);
    svg('rect', {x:0,y:24,width:3,height:H-48,rx:1.5,class:'accent'}, group);
    svg('text', {x:17,y:26,class:'card-tag'}, group, p.group ? '17 人 · 合并条目' : p.generation ? `${String(p.generation).padStart(2,'0')} / 布恩迪亚` : '家族关联');
    svg('text', {x:W-27,y:24,class:'card-icon'}, group, p.group ? '+' : '↗');
    const clip=svg('clipPath',{id:`portrait-clip-${p.id}`,clipPathUnits:'userSpaceOnUse'},chart.querySelector('defs'));
    svg('rect',{x:17,y:36,width:72,height:90,rx:5},clip);
    svg('image',{x:17,y:36,width:72,height:90,href:fallbackSrc(p),'clip-path':`url(#portrait-clip-${p.id})`,class:'card-portrait'},group);
    if (p.portrait.kind==='still') svg('image',{x:17,y:36,width:72,height:90,href:portraitSrc(p),'clip-path':`url(#portrait-clip-${p.id})`,'data-portrait-id':p.id,class:'card-portrait'},group);
    p.lines.forEach((line,i) => svg('text', {x:104,y:p.lines.length === 1 ? 80 : 65+i*30,class:'card-name', ...(line.length>8 ? {textLength:W-120,lengthAdjust:'spacingAndGlyphs'} : {})}, group,line));
    svg('text', {x:17,y:153,class:'card-caption', ...(p.caption.length>16 ? {textLength:W-34,lengthAdjust:'spacingAndGlyphs'} : {})}, group,p.caption);
    group.addEventListener('click', () => { if (!moved) selectPerson(p.id); });
    group.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {e.preventDefault(); selectPerson(p.id);}
    });
    group.addEventListener('focus', () => {
      const x = view.x + (p.x+W/2)*view.scale, y = view.y+(p.y+H/2)*view.scale;
      if (x<30 || x>chart.clientWidth-30 || y<30 || y>chart.clientHeight-60) focusPerson(p, false);
    });
    nodes.set(p.id,group);
  }

  function announce(text) { $('#announcement').textContent = text; }
  function applyView() {
    world.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.scale})`);
    $('#zoom-value').textContent = `${Math.round(view.scale*100)}%`;
    const nearest = data.generations.reduce((best,g) => Math.abs(g.y-(100-view.y)/view.scale)<Math.abs(best.y-(100-view.y)/view.scale)?g:best);
    document.querySelectorAll('[data-generation]').forEach(b => {
      const active = Number(b.dataset.generation) === nearest.number;
      b.classList.toggle('active',active);
      if (active) b.setAttribute('aria-current','true'); else b.removeAttribute('aria-current');
    });
  }
  function centerPerson(p,scale,alignTop=false) {
    const box=visibleCanvasBox();
    view.scale=scale;
    view.x=box.x+box.width/2-(p.x+W/2)*scale;
    view.y=alignTop?104-p.y*scale:box.y+box.height*.45-(p.y+H/2)*scale;
    applyView();
  }
  function defaultView() {
    viewMode='initial';generationFocus=null;
    const first=people.get('jose-founder'),second=people.get('ursula');
    view.scale=READING_SCALE;
    view.x=chart.clientWidth/2-(first.x+second.x+W)/2*view.scale;
    view.y=104-data.generations[0].y*view.scale;
    applyView();
  }
  function overviewCamera() {
    const box=visibleCanvasBox();
    view.scale=Math.min(box.width/data.width,box.height/data.height);
    view.x=box.x+(box.width-data.width*view.scale)/2;
    view.y=box.y+(box.height-data.height*view.scale)/2;
    applyView();
  }
  function fitAll() {
    clearSelection();viewMode='overview';overviewCamera();
    announce('已显示完整图谱。点击阅读比例可恢复清晰字号。');
  }
  function readingView() {
    const box=visibleCanvasBox();
    const centerX=(box.x+box.width/2-view.x)/view.scale;
    const centerY=(box.y+box.height/2-view.y)/view.scale;
    const anchor=selected?people.get(selected):selectedEvent?people.get(events.get(selectedEvent).personIds[0]):null;
    viewMode='reading';
    if(anchor)centerPerson(anchor,READING_SCALE);
    else {
      view.scale=READING_SCALE;
      view.x=box.x+box.width/2-centerX*view.scale;
      view.y=box.y+box.height/2-centerY*view.scale;
      applyView();
    }
    announce('已恢复 80% 阅读比例');
  }
  function zoom(factor, x=chart.clientWidth/2, y=chart.clientHeight/2) {
    viewMode='manual';
    const next=Math.max(.1,Math.min(1.8,view.scale*factor)),ratio=next/view.scale;
    view.x=x-(x-view.x)*ratio;view.y=y-(y-view.y)*ratio;view.scale=next;applyView();
  }
  function focusPerson(p,magnify=true) {
    viewMode=magnify?'person':'manual';
    centerPerson(p,magnify?Math.max(1,view.scale):view.scale);
  }
  function goGeneration(number) {
    clearSelection();
    generationFocus=data.generations.find(g=>g.number===number).focusPersonId;
    viewMode='generation';centerPerson(people.get(generationFocus),READING_SCALE,true);
    announce(`已定位${genName(number)}，保持 80% 阅读比例`);
  }
  function refreshRelations() {
    const eventPeople=new Set(selectedEvent?events.get(selectedEvent).personIds:[]);
    const hasSelection=!!(selected||selectedEvent);
    const related=selectedEvent?eventPeople:new Set(selected?[selected]:[]);
    const touching=relation=>selectedEvent
      ? eventPeople.has(relation.from)&&eventPeople.has(relation.to)
      : !!selected&&(relation.from===selected||relation.to===selected);
    const allowed=relation=>relation.type==='social'?touching(relation):enabled.has(filterCategory(relation));
    for(const edge of drawnEdges) {
      const visibleOwners=edge.owners.filter(allowed);
      edge.element.style.display=visibleOwners.length?'':'none';
      edge.highlighted=visibleOwners.some(touching);
      for(const path of edge.paths) {
        path.classList.toggle('highlighted',edge.highlighted);
        path.classList.toggle('dimmed',hasSelection&&!edge.highlighted);
      }
      if(selected)for(const relation of visibleOwners.filter(touching)){related.add(relation.from);related.add(relation.to);}
    }
    // Underpasses stay distinct, and the active route is always painted on top.
    for(const highlighted of [false,true])for(const edge of drawnEdges)if(edge.highlighted===highlighted)$('#connections').append(edge.element);
    for(const dot of drawnJunctions) {
      const owners=dot.owners.filter(allowed),highlighted=owners.some(touching);
      dot.element.style.display=owners.length?'':'none';
      dot.element.classList.toggle('dimmed',hasSelection&&!highlighted);
    }
    $('#connections').append(junctionLayer);
    for(const label of relationshipLabels)label.element.style.display=allowed(label.relation)?'':'none';
    $('#connections').append(relationshipLabelLayer);
    for (const [id,node] of nodes) {
      node.classList.toggle('selected',id===selected);
      node.classList.toggle('event-related',eventPeople.has(id));
      node.classList.toggle('dimmed',hasSelection&&!related.has(id));
      node.setAttribute('aria-pressed',String(id===selected));
    }
    $('#selection-caption').hidden=!hasSelection;
    $('#canvas-caption').textContent=selectedEvent?events.get(selectedEvent).title:selected?people.get(selected).name:'';
  }
  function visibleCanvasBox() {
    return {x:28,y:66,width:Math.max(1,chart.clientWidth-56),height:Math.max(1,chart.clientHeight-138)};
  }
  function focusEvent(event) {
    const participants=event.personIds.map(id=>people.get(id));
    const left=Math.min(...participants.map(p=>p.x));
    const top=Math.min(...participants.map(p=>p.y));
    const right=Math.max(...participants.map(p=>p.x+W));
    const bottom=Math.max(...participants.map(p=>p.y+H));
    const box=visibleCanvasBox();
    viewMode='event';
    view.scale=Math.min(.95,box.width/(right-left),box.height/(bottom-top));
    view.x=box.x+(box.width-(right-left)*view.scale)/2-left*view.scale;
    view.y=box.y+(box.height-(bottom-top)*view.scale)/2-top*view.scale;
    applyView();
  }
  function setPanelTab(tab) {
    if(tab==='person'&&!detailPerson)tab='timeline';
    $('#person-tab').disabled=!detailPerson;
    for(const name of ['timeline','person']) {
      const active=tab===name;
      $('#'+name+'-tab').setAttribute('aria-selected',String(active));
      $('#'+name+'-tab').tabIndex=active?0:-1;
      $('#'+name+'-pane').hidden=!active;
    }
  }
  function setSidebarOpen(open) {
    panel.hidden=!open;
    $('.workarea').classList.toggle('sidebar-collapsed',!open);
    $('#toggle-sidebar').setAttribute('aria-expanded',String(open));
    $('#toggle-sidebar').textContent=open?'收起侧栏':'展开侧栏';
  }
  function openPanel(tab) {
    setSidebarOpen(true);setPanelTab(tab);
  }
  function closePanel() {
    setSidebarOpen(false);$('#toggle-sidebar').focus({preventScroll:true});
  }
  function renderTimeline(preserveScroll=false) {
    const scroller=$('#timeline-content'),oldScroll=scroller.scrollTop;
    const list=timelineFilter?eventsByPerson.get(timelineFilter):timeline.events;
    $('#timeline-count').textContent=`${list.length} 个事件`;
    $('#clear-timeline-filter').hidden=!timelineFilter;
    $('#timeline-filter').hidden=!timelineFilter;
    $('#timeline-filter').innerHTML=timelineFilter?`<span>${esc(people.get(timelineFilter).name)}</span><button data-clear-filter aria-label="清除人物事件筛选">×</button>`:'';
    scroller.innerHTML=list.length?timeline.phases.map(phase=>{
      const group=list.filter(event=>event.phase===phase.id);
      if(!group.length)return '';
      return `<section class="timeline-phase"><h3>${esc(phase.title)}</h3><ol class="timeline-list">${group.map(event=>{
        const active=selectedEvent===event.id;
        const details=active?`<div class="event-summary">${proseHTML(event.summary)}</div><div class="event-people">${event.personIds.map(id=>{
          const p=people.get(id);
          return `<button data-open="${esc(id)}" title="${esc(p.name)} · ${p.generation?genName(p.generation):'关联人物'}">${portraitHTML(p,'event-portrait')}<span>${esc(p.name)}</span></button>`;
        }).join('')}</div>`:'';
        return `<li class="timeline-item${active?' active':''}" data-event-row="${event.id}" value="${event.order}"><button class="event-button" data-event="${event.id}" aria-expanded="${active}" aria-controls="event-info-${event.id}"><span class="event-order">${String(event.order).padStart(2,'0')}</span><span>${esc(event.title)}</span><span class="event-chevron" aria-hidden="true">${active?'−':'+'}</span></button><div class="event-info" id="event-info-${event.id}"${active?'':' hidden'}>${details}</div></li>`;
      }).join('')}</ol></section>`;
    }).join(''):'<div class="empty-events"><p>暂无相关事件</p><button data-clear-filter>全部事件</button></div>';
    scroller.scrollTop=preserveScroll?oldScroll:0;
  }
  function scrollToEvent(id,focus=false) {
    const scroller=$('#timeline-content');
    const row=scroller.querySelector(`[data-event-row="${id}"]`);
    if(!row)return;
    const button=row.querySelector('.event-button');
    if(focus)button.focus({preventScroll:true});
    scroller.scrollTop+=row.getBoundingClientRect().top-scroller.getBoundingClientRect().top-12;
  }
  function selectEvent(id) {
    const event=events.get(id);if(!event)return;
    if(selectedEvent===id&&!$('#timeline-pane').hidden){clearSelection();scrollToEvent(id,true);announce('已收起事件');return;}
    // Retain a person's event filter when following an event from their details.
    // A programmatic jump outside that filter must still reveal its destination.
    if(timelineFilter&&!event.personIds.includes(timelineFilter))timelineFilter=null;
    selected=null;selectedEvent=id;
    // Keep the last biography and its scroll position available while exploring events.
    closeSearch();
    renderTimeline(true);openPanel('timeline');refreshRelations();focusEvent(event);
    scrollToEvent(id,true);
    announce(`事件 ${event.order}：${event.title}。已定位 ${event.personIds.length} 位相关人物。`);
  }
  function clearTimelineFilter() {
    timelineFilter=null;renderTimeline();setPanelTab('timeline');
    if(selectedEvent)scrollToEvent(selectedEvent);
    $('#timeline-tab').focus({preventScroll:true});
    announce('已显示全部事件');
  }
  function relationButton(id, type, label='') {
    const p=people.get(id);
    return `<button class="relation-link" data-open="${esc(id)}"><i class="line-sample ${esc(type)}"></i><span class="relation-name">${esc(p.name)}<small>${esc(label || (p.generation?`${genName(p.generation)} · ${p.caption}`:p.caption))}</small></span><span class="relation-arrow">↗</span></button>`;
  }
  function personDetail(p) {
    const sections = [
      ['亲生父母',allRelations.filter(r=>r.to===p.id&&r.type==='blood').map(r=>({id:r.from,type:r.type}))],
      ['养父母',allRelations.filter(r=>r.to===p.id&&r.type==='adopt').map(r=>({id:r.from,type:r.type}))],
      ['婚姻与伴侣',allRelations.filter(r=>(r.from===p.id||r.to===p.id)&&['marriage','partner'].includes(r.type)).map(r=>({id:r.from===p.id?r.to:r.from,type:r.type,label:r.label}))],
      ['亲生子女',allRelations.filter(r=>r.from===p.id&&r.type==='blood').map(r=>({id:r.to,type:r.type}))],
      ['收养子女',allRelations.filter(r=>r.from===p.id&&r.type==='adopt').map(r=>({id:r.to,type:r.type}))]
    ];
    const parents=new Set(allRelations.filter(r=>r.to===p.id&&r.type==='blood').map(r=>r.from));
    const siblings=[...new Set(allRelations.filter(r=>r.type==='blood'&&parents.has(r.from)&&r.to!==p.id).map(r=>r.to))];
    if(siblings.length) sections.push(['兄弟姐妹（含同父／同母）',siblings.map(id=>({id,type:'blood'}))]);
    sections.push(['亲属联系',allRelations.filter(r=>r.kinshipLabel&&(r.from===p.id||r.to===p.id)).map(r=>({id:r.from===p.id?r.to:r.from,type:'social',label:r.label}))]);
    sections.push(['其他直接联系',allRelations.filter(r=>r.type==='social'&&!r.kinshipLabel&&(r.from===p.id||r.to===p.id)).map(r=>({id:r.from===p.id?r.to:r.from,type:'social',label:r.label}))]);
    const relationshipHTML=sections.filter(([,items])=>items.length).map(([title,items])=>`<section class="relation-section"><h3 class="relation-heading">${title}</h3>${items.map(i=>relationButton(i.id,i.type,i.label)).join('')}</section>`).join('');
    const members=p.members?`<section class="relation-section"><h3 class="relation-heading">十七子的名单与说明</h3><ol class="group-list">${p.members.map(m=>`<li>${esc(m.name)}<small>${esc(m.original)}</small>${esc(m.description)}</li>`).join('')}</ol></section>`:'';
    const photoCredit=p.portrait.kind==='still'?`<span>${p.portrait.actor?`${esc(p.portrait.actor)} 饰 · `:''}${esc(p.portrait.credit)}</span><a href="${esc(p.portrait.sourceUrl)}" target="_blank" rel="noreferrer">图片来源 ↗</a>`:'';
    const relatedEvents=eventsByPerson.get(p.id);
    const relatedEventHTML=`<section class="related-events"><h3>相关事件 <span>${relatedEvents.length}</span></h3>${relatedEvents.length?relatedEvents.map(event=>`<button data-event="${event.id}"><span>${String(event.order).padStart(2,'0')}</span>${esc(event.title)}<span aria-hidden="true">↗</span></button>`).join(''):'<p>暂无相关事件</p><button data-clear-filter>全部事件</button>'}</section>`;
    $('#detail-content').innerHTML=`<div class="person-actions"><button class="text-button" id="close-detail" aria-label="取消人物选择">取消选择</button></div><div class="person-heading">${portraitHTML(p,'detail-portrait')}<div><h2 class="person-title">${esc(p.name)}</h2><p class="person-original">${esc(p.original)}</p><span class="person-badge">${p.generation?`${genName(p.generation)}${p.id==='rebeca'?' · 收养':''}`:'家族关联人物'}${p.group?' · 17 人':''}</span></div></div><p class="portrait-stage" data-portrait-note="${esc(p.id)}">${esc(portraitLabel(p))}</p>${photoCredit?`<details class="portrait-credit"><summary>图片来源</summary><div>${photoCredit}</div></details>`:''}<div class="person-description">${proseHTML(p.description)}</div>${p.note?`<p class="identity-note">${esc(p.note)}</p>`:''}${relatedEventHTML}${members}${relationshipHTML}`;
    $('#close-detail').addEventListener('click',()=>clearSelection(true));
  }
  function selectPerson(id) {
    const p=people.get(id);if(!p)return;
    selected=id;selectedEvent=null;timelineFilter=id;detailPerson=id;
    closeSearch();personDetail(p);renderTimeline();openPanel('person');
    $('#detail-content').scrollTop=0;refreshRelations();focusPerson(p);
    $('#close-detail').focus({preventScroll:true});
    announce(`已选择${p.name}，${eventsByPerson.get(id).length} 个相关事件。`);
  }
  function clearSelection(returnFocus=false) {
    const previous=selected,previousEvent=selectedEvent;
    selected=null;selectedEvent=null;detailPerson=null;$('#detail-content').innerHTML='';
    renderTimeline(true);setPanelTab('timeline');refreshRelations();
    if(returnFocus&&previous)nodes.get(previous).focus({preventScroll:true});
    else if(returnFocus&&previousEvent)scrollToEvent(previousEvent,true);
  }
  panel.addEventListener('click',e=>{
    const personButton=e.target.closest('[data-open]');
    const eventButton=e.target.closest('[data-event]');
    if(personButton)selectPerson(personButton.dataset.open);
    else if(eventButton)selectEvent(eventButton.dataset.event);
    else if(e.target.closest('[data-clear-filter]'))clearTimelineFilter();
  });
  $('#clear-timeline-filter').addEventListener('click',clearTimelineFilter);
  $('#clear-selection').addEventListener('click',()=>clearSelection(true));
  $('#toggle-sidebar').addEventListener('click',()=>{
    setSidebarOpen(panel.hidden);
    if(!panel.hidden)$('#'+($('#person-pane').hidden?'timeline':'person')+'-tab').focus({preventScroll:true});
  });
  $('#reading-view').addEventListener('click',readingView);
  $('#close-panel').addEventListener('click',closePanel);
  for(const tab of ['timeline','person'])$('#'+tab+'-tab').addEventListener('click',()=>setPanelTab(tab));
  $('.panel-tabs').addEventListener('keydown',e=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
    e.preventDefault();
    const tabs=[...document.querySelectorAll('.panel-tabs button:not(:disabled)')];
    const index=tabs.indexOf(document.activeElement);
    const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(index+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
    tabs[next].click();tabs[next].focus({preventScroll:true});
  });
  const normalize=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/阿尔卡迪奥/g,'阿尔卡蒂奥').replace(/雷梅黛丝|蕾梅黛斯/g,'蕾梅黛丝').replace(/阿玛兰塔/g,'阿玛兰妲').replace(/[^a-z0-9\u3400-\u9fff]/g,'');
  const search=$('#search'), results=$('#search-results');
  function closeSearch(){results.hidden=true;searchIndex=-1;}
  function searchPeople() {
    const query=normalize(search.value); searchIndex=-1;
    if(!query){closeSearch();return;}
    const found=data.people.filter(p=>normalize([p.name,p.original,p.caption,...(p.aliases||[]),p.generation?genName(p.generation):''].join(' ')).includes(query));
    results.innerHTML=found.length?found.map(p=>`<button class="search-result" data-result="${esc(p.id)}">${portraitHTML(p,'search-portrait')}<span>${esc(p.name)}<small>${p.generation?genName(p.generation):'关联人物'} · ${esc(p.caption)}</small></span></button>`).join(''):'<div class="no-results">未找到这个名字。试试简称、西文名或另一种译名。</div>';
    results.hidden=false; announce(`找到 ${found.length} 个匹配条目`);
  }
  search.addEventListener('input',searchPeople);
  search.addEventListener('focus',()=>{if(search.value)searchPeople();});
  results.addEventListener('click',e=>{const b=e.target.closest('[data-result]');if(b){selectPerson(b.dataset.result);search.blur();}});
  $('.search-wrap').addEventListener('keydown',e=>{
    if(e.key==='Escape'){closeSearch();search.focus();e.stopPropagation();return;}
    const buttons=[...results.querySelectorAll('[data-result]')];
    if(!buttons.length||results.hidden)return;
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){
      e.preventDefault();searchIndex=(searchIndex+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[searchIndex].focus();
    } else if(e.key==='Enter' && e.target===search){e.preventDefault();selectPerson(buttons[0].dataset.result);search.blur();}
  });
  document.addEventListener('click',e=>{if(!e.target.closest('.search-wrap'))closeSearch();});
  document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{
    const type=b.dataset.filter;if(enabled.has(type))enabled.delete(type);else enabled.add(type);
    b.setAttribute('aria-pressed',String(enabled.has(type)));refreshRelations();announce(`${b.textContent}关系已${enabled.has(type)?'显示':'隐藏'}`);
  }));
  $('#overview').addEventListener('click',fitAll);
  $('#zoom-in').addEventListener('click',()=>zoom(1.2));
  $('#zoom-out').addEventListener('click',()=>zoom(1/1.2));
  $('#reset-view').addEventListener('click',()=>{timelineFilter=null;clearSelection();setSidebarOpen(true);$('#timeline-content').scrollTop=0;closeSearch();search.value='';enabled.clear();document.querySelectorAll('[data-filter]').forEach(b=>{enabled.add(b.dataset.filter);b.setAttribute('aria-pressed','true');});refreshRelations();defaultView();announce('已重置图谱和关系筛选');});
  chart.addEventListener('wheel',e=>{e.preventDefault();const r=chart.getBoundingClientRect();zoom(Math.exp(-e.deltaY*.0015),e.clientX-r.left,e.clientY-r.top);},{passive:false});
  function local(e){const r=chart.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
  chart.addEventListener('pointerdown',e=>{
    if(e.button!==0||drag)return;
    moved=false;drag={id:e.pointerId,point:local(e),x:view.x,y:view.y};
    e.target.setPointerCapture(e.pointerId);
  });
  chart.addEventListener('pointermove',e=>{
    if(!drag||drag.id!==e.pointerId)return;
    const point=local(e),dx=point.x-drag.point.x,dy=point.y-drag.point.y;
    if(Math.hypot(dx,dy)>4)moved=true;
    if(moved){viewMode='manual';view.x=drag.x+dx;view.y=drag.y+dy;chart.classList.add('dragging');applyView();}
  });
  function endPointer(e){if(drag?.id===e.pointerId){drag=null;chart.classList.remove('dragging');}}
  chart.addEventListener('pointerup',endPointer);chart.addEventListener('pointercancel',endPointer);chart.addEventListener('lostpointercapture',endPointer);
  chart.addEventListener('keydown',e=>{
    if(e.ctrlKey||e.metaKey||e.altKey)return;
    const shifts={ArrowLeft:[55,0],ArrowRight:[-55,0],ArrowUp:[0,55],ArrowDown:[0,-55]};
    if(shifts[e.key]){e.preventDefault();viewMode='manual';view.x+=shifts[e.key][0];view.y+=shifts[e.key][1];applyView();}
    if(e.key==='+'||e.key==='='){e.preventDefault();zoom(1.2);}
    if(e.key==='-'){e.preventDefault();zoom(1/1.2);}
  });
  const dialog=$('#about-dialog');
  $('#about-button').addEventListener('click',()=>dialog.showModal());
  $('#close-about').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
  document.addEventListener('keydown',e=>{
    if(dialog.open)return;
    if(e.key==='/'&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){e.preventDefault();search.focus();}
    if(e.key==='Escape'){closeSearch();if(selected||selectedEvent)clearSelection(true);else if(!panel.hidden)closePanel();}
  });
  let oldSize=null;
  new ResizeObserver(()=>{
    const width=chart.clientWidth,height=chart.clientHeight;
    if(!oldSize||viewMode==='initial')defaultView();
    else if(oldSize.width!==width||oldSize.height!==height){
      if(viewMode==='event'&&selectedEvent)focusEvent(events.get(selectedEvent));
      else if(viewMode==='overview')overviewCamera();
      else if(viewMode==='person'&&selected)centerPerson(people.get(selected),view.scale);
      else if(viewMode==='generation'&&generationFocus)centerPerson(people.get(generationFocus),READING_SCALE,true);
      else if(viewMode==='reading'&&(selected||selectedEvent))centerPerson(people.get(selected||events.get(selectedEvent).personIds[0]),READING_SCALE);
      else{view.x+=(width-oldSize.width)/2;view.y+=(height-oldSize.height)/2;applyView();}
    }
    oldSize={width,height};
  }).observe(chart);
  $('#portrait-count').textContent=data.people.filter(p=>p.portrait.kind==='still').length;
  renderTimeline();setPanelTab('timeline');refreshRelations();
})();
