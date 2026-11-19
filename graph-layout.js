/* Geometry only: logical relationships stay independent of their visual routes. */
(function(root) {
  'use strict';
  const pointKey=p=>p.join(',');
  function compact(points) {
    const result=[];
    for(const point of points) {
      if(result.length&&pointKey(point)===pointKey(result[result.length-1]))continue;
      result.push(point);
      while(result.length>=3) {
        const [a,b,c]=result.slice(-3);
        if((a[0]===b[0]&&b[0]===c[0])||(a[1]===b[1]&&b[1]===c[1]))result.splice(result.length-2,1);
        else break;
      }
    }
    return result;
  }
  function pathData(points,radius=8) {
    let d=`M ${points[0].join(' ')}`;
    for(let i=1;i<points.length;i++) {
      const b=points[i];
      if(i===points.length-1){d+=` L ${b.join(' ')}`;continue;}
      const a=points[i-1],c=points[i+1];
      const before=Math.hypot(b[0]-a[0],b[1]-a[1]),after=Math.hypot(c[0]-b[0],c[1]-b[1]);
      const r=Math.min(radius,before/2,after/2);
      const enter=[b[0]+(a[0]-b[0])*r/before,b[1]+(a[1]-b[1])*r/before];
      const leave=[b[0]+(c[0]-b[0])*r/after,b[1]+(c[1]-b[1])*r/after];
      d+=` L ${enter.join(' ')} Q ${b.join(' ')} ${leave.join(' ')}`;
    }
    return d;
  }
  function build(data) {
    const people=new Map(data.people.map(p=>[p.id,p])),W=data.cardWidth,H=data.cardHeight;
    const relations=[],paths=[],junctions=[],labels=[];
    for(const family of data.families) {
      const mid=family.joinX??family.parents.reduce((sum,id)=>sum+people.get(id).x+W/2,0)/family.parents.length;
      const buckets=new Map();
      for(const from of family.parents)for(const to of family.children) {
        const relation={id:`${family.id}:${from}:${to}`,from,to,type:family.type||'blood',label:family.type==='adopt'?'收养':'亲生'};
        relations.push(relation);
        const p=people.get(from),c=people.get(to),via=family.via?.[from];
        const x=p.x+W/2+(family.parentOffsets?.[from]??family.parentOffsetX??0);
        const points=compact([
          [x,p.y+H],...(via?[[x,via.y],[via.x,via.y],[via.x,family.joinY]]:[[x,family.joinY]]),
          [mid,family.joinY],[mid,family.busY],[c.x+W/2,family.busY],[c.x+W/2,c.y]
        ]);
        for(let i=1;i<points.length;i++) {
          const a=points[i-1],b=points[i],horizontal=a[1]===b[1];
          const fixed=horizontal?a[1]:a[0],axis=horizontal?0:1;
          const key=`${horizontal?'h':'v'}:${fixed}`;
          if(!buckets.has(key))buckets.set(key,{horizontal,fixed,intervals:[]});
          buckets.get(key).intervals.push({lo:Math.min(a[axis],b[axis]),hi:Math.max(a[axis],b[axis]),relation});
        }
      }
      const familyPaths=[];
      // Split at every branch boundary, then paint shared stretches only once.
      for(const {horizontal,fixed,intervals} of buckets.values()) {
        const cuts=[...new Set(intervals.flatMap(i=>[i.lo,i.hi]))].sort((a,b)=>a-b);
        for(let i=1;i<cuts.length;i++) {
          const lo=cuts[i-1],hi=cuts[i],middle=(lo+hi)/2;
          const owners=[...new Map(intervals.filter(s=>s.lo<middle&&s.hi>middle).map(s=>[s.relation.id,s.relation])).values()];
          if(!owners.length)continue;
          const points=horizontal?[[lo,fixed],[hi,fixed]]:[[fixed,lo],[fixed,hi]];
          familyPaths.push({id:`${family.id}-segment-${familyPaths.length}`,group:family.id,type:family.type||'blood',points,owners});
        }
      }
      paths.push(...familyPaths);
      const vertices=new Map();
      for(const path of familyPaths)for(const point of path.points) {
        const key=pointKey(point);
        if(!vertices.has(key))vertices.set(key,{point,paths:[]});
        vertices.get(key).paths.push(path);
      }
      for(const {point,paths:incident} of vertices.values())if(incident.length>=3) {
        const owners=[...new Map(incident.flatMap(p=>p.owners).map(r=>[r.id,r])).values()];
        junctions.push({id:`${family.id}-join-${pointKey(point)}`,group:family.id,type:family.type||'blood',point,owners});
      }
    }
    data.links.forEach((link,index)=>{
      const a=people.get(link.from),b=people.get(link.to);
      const ax=a.x+W/2+(link.fromOffsetX||0),bx=b.x+W/2+(link.toOffsetX||0);
      let points;
      if(link.route==='above') {
        const y=link.routeY??Math.min(a.y,b.y)-30;
        points=[[ax,a.y],[ax,y],[bx,y],[bx,b.y]];
      } else if(link.route==='side-lane') {
        const offset=link.offset||0;
        points=[[a.x,a.y+H/2+offset],[link.lane,a.y+H/2+offset],[link.lane,b.y+H/2+offset],[b.x+W,b.y+H/2+offset]];
      } else if(link.route==='outer'||link.route==='between-rows') {
        const [top,bottom,tx,btx]=a.y<=b.y?[a,b,ax,bx]:[b,a,bx,ax];
        if(link.route==='between-rows') {
          const y=link.routeY??(top.y+H+bottom.y)/2;
          points=[[tx,top.y+H],[tx,y],[btx,y],[btx,bottom.y]];
        } else points=[[tx,top.y+H],[tx,top.y+H+28],[link.lane,top.y+H+28],[link.lane,bottom.y-28],[btx,bottom.y-28],[btx,bottom.y]];
      } else if(a.y===b.y) {
        const [left,right]=a.x<b.x?[a,b]:[b,a];
        points=[[left.x+W,left.y+H/2],[right.x,right.y+H/2]];
      } else {
        const [top,bottom,tx,btx]=a.y<b.y?[a,b,ax,bx]:[b,a,bx,ax];
        const y=(top.y+H+bottom.y)/2;
        points=[[tx,top.y+H],[tx,y],[btx,y],[btx,bottom.y]];
      }
      const relation={id:`link-${index}`,from:link.from,to:link.to,type:link.type,label:link.label,kinshipLabel:link.kinshipLabel};
      relations.push(relation);
      const route=compact(points);
      paths.push({id:relation.id,group:relation.id,type:relation.type,points:route,owners:[relation]});
      if(link.kinshipLabel) {
        const segments=route.slice(1).map((b,i)=>({a:route[i],b,length:Math.hypot(b[0]-route[i][0],b[1]-route[i][1])}));
        const vertical=segments.filter(s=>s.a[0]===s.b[0]&&s.length>=120);
        const segment=(vertical.length?vertical:segments).sort((a,b)=>b.length-a.length)[0];
        const cx=(segment.a[0]+segment.b[0])/2,cy=(segment.a[1]+segment.b[1])/2;
        const width=Math.max(54,link.kinshipLabel.length*18+16),height=32;
        const isVertical=segment.a[0]===segment.b[0],side=link.labelSide==='left'?-1:1;
        const x=isVertical?cx+(side===1?8:-width-8):cx-width/2;
        labels.push({relation,text:link.kinshipLabel,x,y:cy-height/2,width,height,
          ...(isVertical?{anchor:[cx,cy],leaderEnd:[side===1?x:x+width,cy]}:{})});
      }
    });
    for(const path of paths)path.d=pathData(path.points);
    // Headings must clear auxiliary cards between generations, such as Pietro.
    const generationGuides=data.generations.map(gen=>{
      const previous=data.people.filter(p=>p.y<gen.y);
      const labelY=Math.max(gen.y-75,previous.length?Math.max(...previous.map(p=>p.y+H))+42:-Infinity);
      return {...gen,labelX:42,labelY,guideY:labelY+15,labelWidth:190,labelHeight:24};
    });
    return {relations,paths,junctions,generationGuides,labels};
  }
  root.buildMacondoLayout=build;
  if(typeof module!=='undefined'&&module.exports)module.exports=build;
})(typeof window!=='undefined'?window:globalThis);
