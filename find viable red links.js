(async () => {
    // 👇 CHANGE THIS: Target category (Must use "رده:" prefix for Persian Wikipedia)
    const categoryName = "رده:الگو:انتخابات و همه‌پرسی"; 
    const summary = "اصلاح پیوندهای قرمز انگلیسی به معادل فارسی از طریق ویکی‌داده";
    
    console.log("1. در حال دریافت توکن ویرایش (CSRF)...");
    // Step 1: Get Edit Token
    const tokenRes = await fetch('/w/api.php?action=query&meta=tokens&format=json', { credentials: 'include' });
    const tokenData = await tokenRes.json();
    const csrfToken = tokenData.query.tokens.csrftoken;
    
    if (!csrfToken || csrfToken === '+\\') {
        console.error("توکن دریافت نشد. مطمئن شوید که وارد حساب کاربری شده‌اید.");
        return;
    }

    // Helper: Get all pages in a category (handles pagination)
    async function getCategoryMembers(catName) {
        let members = [];
        let continueToken = "";
        do {
            let url = `/w/api.php?action=query&list=categorymembers&cmtitle=${encodeURIComponent(catName)}&cmlimit=500&format=json`;
            if (continueToken) url += `&cmcontinue=${continueToken}`;
            
            const res = await fetch(url, { credentials: 'include' });
            const data = await res.json();
            
            if (!data.query || !data.query.categorymembers) break;
            members = members.concat(data.query.categorymembers.map(m => m.title));
            continueToken = data.continue ? data.continue.cmcontinue : null;
        } while (continueToken);
        return members;
    }

    // Helper: Batch query English Wikipedia to get Wikidata QIDs (Fast!)
    async function getWikidataIds(enTitles) {
        const titleToQid = {};
        const chunkSize = 20; // API limit is 50, using 20 to be safe with long titles
        for (let i = 0; i < enTitles.length; i += chunkSize) {
            const chunk = enTitles.slice(i, i + chunkSize);
            const res = await fetch('https://en.wikipedia.org/w/api.php?origin=*', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    action: 'query', titles: chunk.join('|'), prop: 'pageprops',
                    ppprop: 'wikibase_item', redirects: '1', format: 'json'
                })
            });
            const data = await res.json();
            if (data.query && data.query.pages) {
                for (const pid in data.query.pages) {
                    const page = data.query.pages[pid];
                    if (page.pageprops && page.pageprops.wikibase_item) {
                        titleToQid[page.title] = page.pageprops.wikibase_item;
                    }
                }
            }
            await new Promise(r => setTimeout(r, 100)); // Tiny delay for politeness
        }
        return titleToQid;
    }

    // Helper: Batch query Wikidata to get Persian (fawiki) titles (Fast!)
    async function getFarsiTitles(qids) {
        const qidToFarsi = {};
        const chunkSize = 20;
        for (let i = 0; i < qids.length; i += chunkSize) {
            const chunk = qids.slice(i, i + chunkSize);
            const res = await fetch('https://www.wikidata.org/w/api.php?origin=*', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    action: 'wbgetentities', ids: chunk.join('|'), props: 'sitelinks',
                    sitefilter: 'fawiki', format: 'json'
                })
            });
            const data = await res.json();
            if (data.entities) {
                for (const qid in data.entities) {
                    const entity = data.entities[qid];
                    if (entity.sitelinks && entity.sitelinks.fawiki) {
                        qidToFarsi[qid] = entity.sitelinks.fawiki.title;
                    }
                }
            }
            await new Promise(r => setTimeout(r, 100));
        }
        return qidToFarsi;
    }

    // Helper: Save the modified page back to Wikipedia
    async function savePage(pageTitle, newText, token, editSummary) {
        const editRes = await fetch('/w/api.php', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                action: 'edit', title: pageTitle, text: newText,
                summary: editSummary, token: token, format: 'json'
            })
        });
        const editData = await editRes.json();
        return (editData.edit && editData.edit.result === "Success");
    }

    // --- MAIN EXECUTION ---
    console.log(`2. در حال دریافت لیست صفحات رده: ${categoryName}`);
    const pagesToProcess = await getCategoryMembers(categoryName);
    console.log(`تعداد صفحات یافت شده: ${pagesToProcess.length}`);

    let processedCount = 0;
    for (const pageTitle of pagesToProcess) {
        processedCount++;
        console.log(`\n--- بررسی صفحه ${processedCount}/${pagesToProcess.length}: ${pageTitle} ---`);
        
        try {
            const textRes = await fetch(`/w/api.php?action=query&prop=revisions&rvprop=content&titles=${encodeURIComponent(pageTitle)}&format=json`, { credentials: 'include' });
            const textData = await textRes.json();
            const pages = textData.query.pages;
            const pageId = Object.keys(pages)[0];
            
            if (pages[pageId].missing !== undefined) continue;
            let wikitext = pages[pageId].revisions[0]['*'];
            
            // Regex to find [[English Title]] or [[English Title|Display text]]
            const regex = /\[\[([A-Za-z0-9_ \-\.'(),&]+)(\|.*?)?\]\]/g;
            const englishLinks = new Set();
            let match;
            while ((match = regex.exec(wikitext)) !== null) {
                englishLinks.add(match[1].trim());
            }
            
            if (englishLinks.size === 0) {
                console.log("هیچ پیوند انگلیسی یافت نشد.");
                continue;
            }
            
            console.log(`${englishLinks.size} پیوند انگلیسی یافت شد. در حال دریافت ویکی‌داده (Batch)...`);
            const enTitlesArray = Array.from(englishLinks);
            
            // 1. Get QIDs from EN Wikipedia in batches
            const titleToQid = await getWikidataIds(enTitlesArray);
            if (Object.keys(titleToQid).length === 0) continue;
            
            // 2. Get Farsi Titles from Wikidata in batches
            const qids = Array.from(new Set(Object.values(titleToQid)));
            const qidToFarsi = await getFarsiTitles(qids);
            
            // 3. Map back to English titles for replacement
            const replacements = {};
            for (const [enTitle, qid] of Object.entries(titleToQid)) {
                if (qidToFarsi[qid]) replacements[enTitle] = qidToFarsi[qid];
            }
            
            if (Object.keys(replacements).length === 0) {
                console.log("هیچ معادل فارسی در ویکی‌داده یافت نشد.");
                continue;
            }
            
            console.log(`در حال جایگزینی ${Object.keys(replacements).length} پیوند در متن...`);
            let newWikitext = wikitext;
            for (const [enTitle, faTitle] of Object.entries(replacements)) {
                const escapedEn = enTitle.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&').replace(/ /g, '[ _]');
                const linkRegex = new RegExp(`\\[\\[(${escapedEn})(\\|.*?)?\\]\\]`, 'gi');
                
                newWikitext = newWikitext.replace(linkRegex, (fullMatch, matchedTitle, displayText) => {
                    return displayText ? `[[${faTitle}${displayText}]]` : `[[${faTitle}]]`;
                });
            }
            
            console.log("در حال ذخیره تغییرات...");
            const saved = await savePage(pageTitle, newWikitext, csrfToken, summary);
            if (saved) {
                console.log(`✅ صفحه ${pageTitle} با موفقیت ذخیره شد!`);
            } else {
                console.log(`❌ خطا در ذخیره صفحه ${pageTitle}.`);
            }
            
            // Safety delay between page edits to avoid bot blocks
            await new Promise(r => setTimeout(r, 3000)); 
            
        } catch (err) {
            console.error(`خطای غیرمنتظره در صفحه ${pageTitle}:`, err);
        }
    }
    
    console.log("\n🎉 پردازش تمام صفحات رده به پایان رسید!");
})();
