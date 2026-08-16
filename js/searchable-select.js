// Searchable dropdown (combobox) for the long master lists on the JD form.
//
// WHY: the position list holds ~85 entries. A plain <select> makes the user scroll
// a wall of text, and the browser's own type-ahead only matches from the first
// character, so "Senior Sales Manager" cannot be found by typing "sales".
//
// HOW: the real <select> stays in the DOM, keeps its id, and remains the single
// source of truth — it is only hidden. Everything else in the app therefore keeps
// working untouched: $('#positionName').val() still reads the value, the field
// validator still listens for 'change', collectFormData() still collects it, and
// the print stylesheet still has a value to render.
//
// Typing filters; it never sets a value. A value is only ever set by picking a real
// option, so free text stays impossible — which is the whole point of these two
// fields being a list in the first place.
//
// Used by: js/config-loader.js (after it fills the options from Firestore)
window.JDSelect = (function () {
    'use strict';

    function optionsOf($sel) {
        // The placeholder carries an empty value and is not a real choice.
        return $sel.find('option').filter(function () { return this.value !== ''; })
            .map(function () { return { value: this.value, label: $(this).text() }; })
            .get();
    }

    function placeholderOf($sel) {
        const $ph = $sel.find('option[value=""]').first();
        return $ph.length ? $ph.text().replace(/^[-\s]+|[-\s]+$/g, '') : 'เลือก...';
    }

    // Label currently held by the <select>, or '' when nothing is chosen.
    function currentLabel($sel) {
        const v = $sel.val();
        if (!v) return '';
        const hit = optionsOf($sel).find(function (o) { return o.value === v; });
        return hit ? hit.label : '';
    }

    function enhance(selectEl) {
        const $sel = $(selectEl);
        if (!$sel.length || !$sel.is('select')) return;

        // Called again whenever the options are refreshed (the first paint comes from
        // the localStorage cache, the second from Firestore) — rebuild the list rather
        // than wrapping the field a second time.
        if ($sel.data('jdCombo')) {
            const api = $sel.data('jdCombo');
            api.refresh();
            return;
        }

        const $wrap = $('<div class="jd-combo"></div>').insertBefore($sel);
        $sel.addClass('jd-combo-native').appendTo($wrap);

        const $input = $('<input type="text" class="jd-combo-input" autocomplete="off" role="combobox" aria-expanded="false" aria-autocomplete="list">')
            .attr('placeholder', placeholderOf($sel))
            .appendTo($wrap);

        // Point the field's <label> at the visible control. Left on the select, a
        // click on the label would focus an element nobody can see.
        const selId = $sel.attr('id');
        if (selId) {
            const inputId = selId + 'Search';
            $input.attr('id', inputId);
            $('label[for="' + selId + '"]').attr('for', inputId);
        }
        const $list = $('<ul class="jd-combo-list" role="listbox"></ul>').appendTo($wrap);

        let items = [];      // options currently rendered in the list
        let active = -1;      // keyboard-highlighted index within `items`
        let open = false;

        function close(restoreText) {
            open = false;
            active = -1;
            $list.removeClass('show').empty();
            $input.attr('aria-expanded', 'false');
            // The typed text is a search term, not a value. Whatever is left in the box
            // must go back to reflecting the actual selection, or the field would read
            // as something the document does not contain.
            if (restoreText !== false) $input.val(currentLabel($sel));
        }

        function choose(item) {
            $sel.val(item.value);
            $input.val(item.label);
            close(false);
            // Drives the field validator, which listens for 'change' on the select.
            $sel.trigger('change');
        }

        function render(filter) {
            const q = (filter || '').trim().toLowerCase();
            const all = optionsOf($sel);
            items = q
                ? all.filter(function (o) { return o.label.toLowerCase().includes(q); })
                : all;

            $list.empty();
            if (!items.length) {
                $('<li class="jd-combo-empty"></li>')
                    .text(all.length ? 'ไม่พบรายการที่ค้นหา' : 'ไม่พบรายการ กรุณาแจ้งผู้ดูแลระบบ')
                    .appendTo($list);
            } else {
                const chosen = $sel.val();
                items.forEach(function (o, i) {
                    $('<li class="jd-combo-option" role="option"></li>')
                        .text(o.label)
                        .attr('data-i', i)
                        .toggleClass('selected', o.value === chosen)
                        .appendTo($list);
                });
            }

            $list.addClass('show');
            $input.attr('aria-expanded', 'true');
            open = true;
        }

        function setActive(i) {
            if (!items.length) return;
            active = (i + items.length) % items.length;
            $list.find('.jd-combo-option').removeClass('active')
                .filter('[data-i="' + active + '"]').addClass('active')
                .each(function () {
                    // Keep the highlighted row inside the scrolling list.
                    const el = this, box = $list[0];
                    if (el.offsetTop < box.scrollTop) box.scrollTop = el.offsetTop;
                    else if (el.offsetTop + el.offsetHeight > box.scrollTop + box.clientHeight) {
                        box.scrollTop = el.offsetTop + el.offsetHeight - box.clientHeight;
                    }
                });
        }

        $input.on('focus click', function () {
            // Open on the full list: someone who clicks the field wants to browse, and
            // the current selection would otherwise filter everything else away.
            if (!open) render('');
        });

        $input.on('input', function () { render($input.val()); });

        $input.on('keydown', function (e) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                if (!open) { render($input.val()); setActive(0); return; }
                setActive(active + (e.key === 'ArrowDown' ? 1 : -1));
                return;
            }
            if (e.key === 'Enter') {
                // Only ever commits an actual option — never the typed text.
                if (open && active >= 0 && items[active]) { e.preventDefault(); choose(items[active]); }
                return;
            }
            if (e.key === 'Escape' && open) { e.preventDefault(); close(true); }
        });

        // mousedown, not click: it fires before the input's blur, so the selection is
        // made before the blur handler can put the old text back.
        $list.on('mousedown', '.jd-combo-option', function (e) {
            e.preventDefault();
            const item = items[Number($(this).attr('data-i'))];
            if (item) choose(item);
        });

        $input.on('blur', function () {
            close(true);
            // Mirror what the native control did: leaving the field counts as touching
            // it, so an untouched-but-empty field still reports itself as required.
            $sel.trigger('blur');
        });

        const api = {
            refresh: function () {
                $input.attr('placeholder', placeholderOf($sel));
                $input.val(currentLabel($sel));
                if (open) render($input.val());
            }
        };
        $sel.data('jdCombo', api);
        api.refresh();
    }

    return { enhance: enhance };
})();
