(function(){
  const TEMPLATE = document.createElement('template');
  TEMPLATE.innerHTML = `
    <style>
      :host { display:block; }
      .card { background:#fff; color:#111827; border-radius:16px; box-shadow:0 10px 25px rgba(0,0,0,0.08); overflow:hidden; }
      .header { padding:18px 20px; border-bottom:1px solid #f0f2f5; display:flex; align-items:center; gap:12px; }
      .title { font-weight:700; font-size:18px; }
      .body { padding:18px 20px; }

      /* keep inner content from hugging the right edge */
      .body > .intro,
      .body > .quizform,
      .body > .results {
        max-width: 880px;   /* tweak to taste */
        margin-right: auto; /* left align; free space on right */
      }

      .q { border:1px solid #e5e7eb; border-radius:12px; padding:14px; margin-bottom:14px; }
      .q h3 { margin:0 0 10px; font-size:16px; }
      .options { display:grid; gap:10px; }
      label.opt { border:1px solid #e5e7eb; border-radius:12px; padding:10px 12px; cursor:pointer; display:flex; gap:10px; align-items:flex-start; }
      label.opt:hover { border-color:#d1d5db; }
      input[type="radio"], input[type="checkbox"] { margin-top:4px; }
      input[type="text"] { width:100%; padding:10px 12px; border:1px solid #e5e7eb; border-radius:10px; font:inherit; }
      .actions { display:flex; gap:12px; justify-content:flex-end; margin-top:18px; }
      button { appearance:none; border:none; border-radius:12px; padding:10px 14px; font-weight:600; cursor:pointer; box-shadow:0 10px 25px rgba(0,0,0,0.08); }
      button.primary { background:#0ea5e9; color:#fff; }
      button.secondary { background:#e5e7eb; color:#111827; }
      .meta { color:#6b7280; font-size:12px; }
      .pill { display:inline-flex; align-items:center; padding:4px 8px; border-radius:999px; font-size:12px; font-weight:600; }
      .pill.ok { background:#ecfdf5; color:#16a34a; border:1px solid #d1fae5; }
      .pill.bad { background:#fef2f2; color:#ef4444; border:1px solid #fee2e2; }
      .explain { margin-top:8px; font-size:13px; color:#374151; }
      .grid { display:grid; gap:10px; }

      /* generic row */
      .top { display:flex; align-items:center; justify-content:space-between; gap:12px; }

      /* results header row */
      .results-header {
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:12px;
        min-height:64px;
        border-top:1px solid #f0f2f5;
        border-bottom:1px solid #f0f2f5;
        padding:8px 0;
      }

      .hidden { display:none !important; }
      .otp { display:flex; gap:8px; align-items:center; }
      .otp input { max-width:220px; }
      .err { color:#b91c1c; font-size:13px; }
    </style>
    <div class="card" role="region" aria-label="Quiz">
      <div class="header">
        <div class="title"></div>
        <div class="meta" part="meta"></div>
      </div>
      <div class="body">
        <div class="intro grid">
          <div class="grid">
            <label> Name (Required)
              <input id="userName" type="text" placeholder="" />
            </label>
            <div class="otp-wrap hidden">
              <div>Enter OTP to begin:</div>
              <div class="otp">
                <input id="otpInput" type="text" inputmode="numeric" placeholder="" />
                <button class="primary" id="otpBtn" type="button">Start Quiz</button>
              </div>
              <div class="err hidden" id="otpErr">Invalid or used code.</div>
            </div>
          </div>
        </div>
        <form class="quizform hidden" novalidate></form>
        <div class="results hidden" aria-live="polite"></div>
      </div>
    </div>
  `;

  function shuffle(arr){
    return arr.map(v=>[Math.random(), v]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]);
  }
  function toCSV(rows){
    const esc = (v)=>(''+v).replaceAll('"','""');
    return rows.map(r=>r.map(v=>`"${esc(v)}"`).join(',')).join('\n');
  }

  class OnePOSQuiz extends HTMLElement{
    constructor(){
      super();
      this.attachShadow({mode:'open'});
      this.shadowRoot.appendChild(TEMPLATE.content.cloneNode(true));
      this.state = { started:false, submitted:false, data:null, answers:{}, score:0, otpOk:false };
    }

    // helper: control header title based on OTP state
    updateTitle(started = false){
      const el = this.shadowRoot.querySelector('.title');
      const requireOtp = this.hasAttribute('require-otp');
      const quizTitle = this.state?.data?.title || '';
      if (requireOtp && !this.state.otpOk && !started) {
        el.textContent = '';                // keep blank until OTP succeeds
      } else {
        el.textContent = quizTitle || (this.getAttribute('title') || 'Quiz');
      }
    }

    connectedCallback(){
      // initial title: blank if OTP is required, else show attribute/placeholder
      if (this.hasAttribute('require-otp')) {
        this.shadowRoot.querySelector('.title').textContent = '';
      } else {
        this.shadowRoot.querySelector('.title').textContent = this.getAttribute('title') || 'Quiz';
      }
      this.shadowRoot.querySelector('.meta').textContent = '';

      this.shadowRoot.getElementById('otpBtn').addEventListener('click', ()=> this.verifyOTP());

      if(this.hasAttribute('require-otp')){
        this.shadowRoot.querySelector('.otp-wrap').classList.remove('hidden');
      } else {
        // no OTP required → start immediately after data is loaded
      }

      this.loadData()
        .then(()=>{
          // if no OTP is required, show the actual quiz title now
          if (!this.hasAttribute('require-otp')) this.updateTitle(false);
          // if OTP is required, title stays blank until OTP ok
          if (!this.hasAttribute('require-otp')) this.handleStart(true);
        })
        .catch(err=>{ console.error(err); alert('Failed to load quiz data.'); });
    }

    async loadData(){
      const inline = this.querySelector('script[type="application/json"]');
      if(inline){
        this.state.data = JSON.parse(inline.textContent.trim());
        return;
      }
      const src = this.getAttribute('data-src');
      if(src){
        const res = await fetch(src, {cache:'no-store'});
        if(!res.ok) throw new Error('HTTP '+res.status);
        this.state.data = await res.json();
        return;
      }
      // No questions provided (okay if require-otp and quiz is fetched after OTP)
      this.state.data = this.state.data || null;
    }

    // fetch quiz by test_id and update title
    async fetchQuizById(testId){
      if(!testId) throw new Error('Missing test_id');
      const url = `/api/tests/${encodeURIComponent(testId)}`;
      const res = await fetch(url, { cache: 'no-store' });
      if(!res.ok) throw new Error('Quiz fetch failed: ' + res.status);
      this.state.data = await res.json();
      this.updateTitle(true);
    }

    // resolve quiz from OTP → fetch quiz by returned test_id → start
    async verifyOTP(){
      const endpoint = this.getAttribute('data-otp-endpoint');
      if(this.hasAttribute('require-otp') && !endpoint){
        alert('OTP endpoint not set.');
        return;
      }

      const fallbackTestId = this.state.data?.test_id || this.getAttribute('test-id') || '';
      const code = this.shadowRoot.getElementById('otpInput').value.trim();

      if(this.hasAttribute('require-otp')){
        if(!code){ return; }
        try{
          const res = await fetch(endpoint, {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ test_id: fallbackTestId, otp: code })
          });
          const json = await res.json();

          if(json && json.ok){
            const resolvedTestId = json.test_id || fallbackTestId;

            // If OTP points to a different quiz (or none loaded), fetch it
            if(resolvedTestId && (!this.state.data || this.state.data.test_id !== resolvedTestId)){
              try{
                await this.fetchQuizById(resolvedTestId);
              } catch(err){
                console.error('Failed to load quiz for OTP test_id:', err);
                this.shadowRoot.getElementById('otpErr').classList.remove('hidden');
                return;
              }
            }

            this.state.otpOk = true;
            this.shadowRoot.getElementById('otpErr').classList.add('hidden');
            this.updateTitle(true);   // show real quiz title now
            this.handleStart(true);
          } else {
            this.state.otpOk = false;
            this.shadowRoot.getElementById('otpErr').classList.remove('hidden');
          }
        } catch(err){
          console.error(err);
          this.shadowRoot.getElementById('otpErr').classList.remove('hidden');
        }
      } else {
        // No OTP required → start with loaded quiz
        this.updateTitle(true);
        this.handleStart(true);
      }
    }

    handleStart(force=false){
      if(this.hasAttribute('require-otp') && !this.state.otpOk && !force){
        this.shadowRoot.getElementById('otpErr').classList.remove('hidden');
        return;
      }
      if(!this.state.data) return;

      this.updateTitle(true); // ensure header set correctly
      this.state.started = true;

      const showExplanations = this.hasAttribute('show-explanations');
      const doShuffle = this.hasAttribute('shuffle');

      const data = JSON.parse(JSON.stringify(this.state.data));
      if(doShuffle){
        data.questions = shuffle(data.questions);
        data.questions.forEach(q=>{ if(q.options) q.options = shuffle(q.options); });
      }
      this.state.renderData = data;
      this.renderForm(data, {showExplanations});
    }

    renderForm(data){
      const intro = this.shadowRoot.querySelector('.intro');
      const form = this.shadowRoot.querySelector('.quizform');
      const results = this.shadowRoot.querySelector('.results');

      intro.classList.add('hidden');
      results.classList.add('hidden');
      form.classList.remove('hidden');
      form.innerHTML = '';

      data.questions.forEach((q, idx)=>{
        const wrap = document.createElement('div'); wrap.className = 'q'; wrap.setAttribute('data-qid', q.id || ('q'+(idx+1)));
        const h = document.createElement('h3'); h.textContent = `${idx+1}. ${q.text}`; wrap.appendChild(h);
        const options = document.createElement('div'); options.className = 'options';

        if(q.type === 'multiple_choice'){
          (q.options||[]).forEach((opt,i)=>{
            const id = `${q.id||('q'+idx)}_${i}`;
            const lab = document.createElement('label');
            lab.className = 'opt';
            lab.setAttribute('for', id);
            lab.innerHTML = `<input id="${id}" name="${q.id||('q'+idx)}" type="radio" value="${opt}" aria-label="${opt}"/> <span>${opt}</span>`;
            options.appendChild(lab);
          });
        } else if(q.type === 'true_false'){
          ['true','false'].forEach((opt,i)=>{
            const id = `${q.id||('q'+idx)}_${i}`;
            const lab = document.createElement('label');
            lab.className = 'opt';
            lab.setAttribute('for', id);
            lab.innerHTML = `<input id="${id}" name="${q.id||('q'+idx)}" type="radio" value="${opt}" aria-label="${opt}"/> <span>${opt.toUpperCase()}</span>`;
            options.appendChild(lab);
          });
        } else if(q.type === 'short_answer'){
          const inp = document.createElement('input');
          inp.type = 'text';
          inp.name = q.id||('q'+idx);
          inp.placeholder = 'Type your answer';
          inp.setAttribute('aria-label','Short answer');
          options.appendChild(inp);
        } else {
          const warn = document.createElement('div');
          warn.textContent = 'Unsupported question type: '+q.type;
          options.appendChild(warn);
        }

        wrap.appendChild(options);
        form.appendChild(wrap);
      });

      const actions = document.createElement('div'); actions.className = 'actions';
      const submitBtn = document.createElement('button'); submitBtn.className = 'primary'; submitBtn.type = 'button'; submitBtn.textContent = 'Submit';
      const resetBtn = document.createElement('button'); resetBtn.className = 'secondary'; resetBtn.type = 'button'; resetBtn.textContent = 'Reset';
      actions.appendChild(resetBtn); actions.appendChild(submitBtn); form.appendChild(actions);

      submitBtn.addEventListener('click', ()=> this.submit());
      resetBtn.addEventListener('click', ()=> this.resetQuiz());

      const first = form.querySelector('input,button,select,textarea'); if(first) first.focus();
    }

    collectAnswers(){
      const form = this.shadowRoot.querySelector('.quizform');
      const data = this.state.renderData; const answers = {};
      data.questions.forEach((q, idx)=>{
        const name = q.id||('q'+idx);
        if(q.type === 'multiple_choice' || q.type === 'true_false'){
          const sel = form.querySelector(`input[name="${name}"]:checked`);
          answers[name] = sel ? sel.value : '';
        } else if(q.type === 'short_answer'){
          const sel = form.querySelector(`input[name="${name}"]`);
          answers[name] = (sel?.value || '').trim();
        }
      });
      return answers;
    }

    evaluate(answers){
      const data = this.state.renderData; let correct = 0; const rows = [];
      data.questions.forEach((q, idx)=>{
        const qid = q.id||('q'+idx);
        const user = answers[qid];
        let right = false;
        let correctAns = q.answer;

        if(q.type === 'true_false'){
          const expected = (q.answer===true || q.answer==='true') ? 'true' : 'false';
          right = (user === expected);
          correctAns = expected;
        } else if(q.type === 'short_answer'){
          const accept = Array.isArray(q.answer) ? q.answer : [q.answer];
          const norm = (s)=> String(s||'').trim().toLowerCase();
          right = accept.map(norm).includes(norm(user));
          correctAns = accept.join(' | ');
        } else {
          right = (user === q.answer);
        }

        if(right) correct++;

        rows.push({
          index: idx + 1,
          qid,
          question: q.text,
          type: q.type,
          user_answer: user ?? '',
          correct_answer: correctAns ?? '',
          is_correct: right,
          category: q.category || null
        });
      });
      const scorePct = Math.round((correct / data.questions.length) * 100);
      return { correct, total: data.questions.length, scorePct, rows };
    }

    async submit(){
      const userName = this.shadowRoot.getElementById('userName').value.trim();
      const answers = this.collectAnswers();
      const results = this.evaluate(answers);
      this.state.submitted = true; this.state.answers = answers; this.state.results = results;
      this.renderResults(userName, results);

      const event = new CustomEvent('onepos-quiz:submitted', {
        bubbles: true,
        detail: { test_id: this.state.data?.test_id, title: this.state.data?.title, user_name: userName, ...results }
      });
      this.dispatchEvent(event); window.dispatchEvent(event);

      const postUrl = this.getAttribute('data-post-results');
      if(postUrl){
        try{
          await fetch(postUrl, {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({
              test_id: this.state.data?.test_id,
              title: this.state.data?.title,
              user_name: userName,
              timestamp: new Date().toISOString(),
              ...results
            })
          });
        } catch(e){ console.warn('Failed to post results', e); }
      }
    }

    renderResults(userName, results){
      const form = this.shadowRoot.querySelector('.quizform');
      const out = this.shadowRoot.querySelector('.results');
      form.classList.add('hidden'); out.classList.remove('hidden');
      const showExplanations = this.hasAttribute('show-explanations');
      const data = this.state.renderData;

      const header = `
        <div class="results-header">
          <div>
            <div class="title">Results${userName?` — ${userName}`:''}</div>
            <div class="meta">Score: <strong>${results.scorePct}%</strong> (${results.correct}/${results.total} correct)</div>
          </div>
          <div class="actions">
            <button class="secondary" id="retakeBtn">Retake</button>
            <button class="primary" id="downloadBtn">Download CSV</button>
          </div>
        </div>`;

      const items = results.rows.map((row, i)=>{
        const q = data.questions[i]; const ok = row.is_correct;
        return `<div class="q">
          <div class="top" style="margin-bottom:8px;">
            <h3 style="margin:0; font-size:16px;">${i+1}. ${row.question}</h3>
            <span class="pill ${ok?'ok':'bad'}" aria-label="${ok?'Correct':'Incorrect'}">${ok?'Correct':'Incorrect'}</span>
          </div>
          <div class="meta">Your answer: <strong>${row.user_answer||'<em>Blank</em>'}</strong></div>
          <div class="meta">Correct answer: <strong>${row.correct_answer}</strong></div>
          ${showExplanations && q?.explanation ? `<div class="explain">${q.explanation}</div>`: ''}
        </div>`;
      }).join('');

      out.innerHTML = header + items;
      this.shadowRoot.getElementById('retakeBtn').addEventListener('click', ()=> this.resetQuiz());
      this.shadowRoot.getElementById('downloadBtn').addEventListener('click', ()=> this.downloadCSV(userName));
    }

    downloadCSV(userName){
      const rows = this.state.results.rows;
      const header = [ 'test_id','title','user_name','question_index','question_id','question','type','user_answer','correct_answer','is_correct','score_percent' ];
      const base = rows.map(r=> [
        this.state.data?.test_id || '',
        this.state.data?.title || '',
        userName || '',
        r.index, r.qid, r.question, r.type, r.user_answer, r.correct_answer, r.is_correct,
        this.state.results.scorePct
      ]);
      const csv = toCSV([header, ...base]);
      const blob = new Blob([csv], {type:'text/csv'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const safeTitle = (this.state.data?.test_id || 'quiz_results').replace(/[^a-z0-9_-]/gi,'_');
      a.download = `${safeTitle}_results.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    }

    resetQuiz(){
      this.state.started = false; this.state.submitted = false;
      const intro = this.shadowRoot.querySelector('.intro');
      const form = this.shadowRoot.querySelector('.quizform');
      const results = this.shadowRoot.querySelector('.results');
      intro.classList.remove('hidden'); form.classList.add('hidden'); results.classList.add('hidden');
    }
  }

  customElements.define('onepos-quiz', OnePOSQuiz);
})();
