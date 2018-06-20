const focusables = require('makeup-focusables');
const resizeUtil = require('../../common/event-utils').resizeUtil;
const emitAndFire = require('../../common/emit-and-fire');
const processHtmlAttributes = require('../../common/html-attributes');
const observer = require('../../common/property-observer');
const template = require('./template.marko');

function getInitialState(input) {
    const state = {
        gap: input.gap || 16,
        index: parseInt(input.index, 10) || 0,
        classes: ['carousel',  input.class],
        itemsPerSlide: parseInt(input.itemsPerSlide, 10) || undefined,
        accessibilityPrev: input.accessibilityPrev || 'Previous Slide',
        accessibilityNext: input.accessibilityNext || 'Next Slide',
        accessibilityStatus: input.accessibilityStatus || 'Showing Slide {currentSlide} of {totalSlides} - Carousel',
        accessibilityCurrent: input.accessibilityCurrent || 'Current Slide {currentSlide} - Carousel',
        accessibilityOther: input.accessibilityOther || 'Slide {slide} - Carousel',
        htmlAttributes: processHtmlAttributes(input),
        items: (input.items || []).map(item => ({
            htmlAttributes: processHtmlAttributes(item),
            renderBody: item.renderBody
        }))
    };

    // Remove any extra items when using explicit itemsPerSlide.
    const { items, itemsPerSlide } = state;
    if (itemsPerSlide) {
        items.length -= items.length % itemsPerSlide;
    }

    return state;
}

function getTemplateData(state) {
    const { items, itemsPerSlide, slideWidth } = state;
    const index = state.index - (itemsPerSlide ? state.index % itemsPerSlide : 0);
    const maxOffset = items[items.length - 1].right - slideWidth;
    const offset = Math.min(items[index].left, maxOffset);
    const prevControlDisabled = offset === 0;
    const nextControlDisabled = offset === maxOffset;
    const bothControlsDisabled = prevControlDisabled && nextControlDisabled;
    let slide, itemWidth, totalSlides, accessibilityStatus;

    if (itemsPerSlide) {
        slide = Math.ceil(index / itemsPerSlide);
        itemWidth = `calc(${100 / itemsPerSlide}% - ${(itemsPerSlide - 1) * state.gap / itemsPerSlide}px)`;
        totalSlides = Math.ceil(items.length / itemsPerSlide);
        accessibilityStatus = state.accessibilityStatus
            .replace('{currentSlide}', slide + 1)
            .replace('{totalSlides}', totalSlides);
    } else {
        itemWidth = 'auto';
    }

    items.forEach(item => item.hidden = !isVisible(item, offset, slideWidth));

    const data = Object.assign({}, state, {
        items,
        slide,
        offset,
        itemWidth,
        totalSlides,
        accessibilityStatus,
        prevControlDisabled,
        nextControlDisabled,
        bothControlsDisabled
    });

    return data;
}

function init() {
    this.listEl = this.getEl('list');
    this.containerEl = this.getEl('container');
    this.subscribeTo(resizeUtil).on('resize', onRender.bind(this));
    observer.observeRoot(this, ['index']);

    if (getComputedStyle(this.listEl).getPropertyValue('overflow-x') !== 'visible') {
        this.setState('nativeScrolling', true);
    } else {
        this.subscribeTo(this.listEl).on('transitionend', () => {
            const { state: { index, items, slideWidth } } = this;
            const maxOffset = items[items.length - 1].right - slideWidth;
            const offset = Math.min(items[index].left, maxOffset);
            emitAndFire(this, 'carousel-update', {
                visibleIndexes: items
                    .filter(item => isVisible(item, offset, slideWidth))
                    .map(item => items.indexOf(item))
            });
        });
    }
}

function onRender() {
    if (this.preserveItems) {
        // Track if we are on a normal render or a render caused by recalculating.
        this.preserveItems = false;

        // Ensure only visible items within the carousel are focusable.
        // We don't have access to these items in the template so me must update manually.
        forEls(this.listEl, itemEl => {
            focusables(itemEl).forEach(itemEl.getAttribute('aria-hidden') !== 'true'
                ? child => child.removeAttribute('tabindex')
                : child => child.setAttribute('tabindex', '-1')
            );
        });

        return;
    }
    
    cancelAnimationFrame(this.renderFrame);
    this.renderFrame = requestAnimationFrame(() => {
        const { state: { items } } = this;
        this.preserveItems = true;
        this.setState('slideWidth', this.containerEl.offsetWidth);

        // Update item positions in the dom.
        forEls(this.listEl, (itemEl, i) => {
            const item = items[i++];
            item.left = itemEl.offsetLeft;
            item.right = item.left + itemEl.offsetWidth;
        });
    });
}

function onDestroy() {
    cancelAnimationFrame(this.renderFrame);
}

/**
 * Moves the carousel in the `data-direction` of the clicked element if possible.
 *
 * @param {MouseEvent} originalEvent 
 * @param {HTMLElement} target 
 */
function handleMove(originalEvent, target) {
    const direction = parseInt(target.getAttribute('data-direction'), 10);
    const newIndex = this.getNextIndex(direction);

    if (newIndex !== this.state.index) {
        this.preserveItems = true;
        this.setState('index', newIndex);
        emitAndFire(this, `carousel-${direction === 1 ? 'next' : 'prev'}`, { originalEvent });
    }
}

/**
 * Moves the carousel to the slide at `data-slide` for the clicked element if possible.
 *
 * @param {MouseEvent} originalEvent 
 * @param {HTMLElement} target
 */
function handleDotClick(originalEvent, target) {
    const { state: { index, itemsPerSlide } } = this;
    const slide = parseInt(target.getAttribute('data-slide'), 10);
    let selectedIndex = slide * itemsPerSlide;

    if (index !== selectedIndex) {
        this.preserveItems = true;
        this.setState('index', selectedIndex);
        emitAndFire(this, 'carousel-slide', { originalEvent });
    }
}

/**
 * Calculates the next valid index.
 *
 * @param {-1|1} direction -1 for left and 1 for right.
 * @return {number}
 */
function getNextIndex(direction) {
    const { state: { index, items, slideWidth, itemsPerSlide } } = this;
    let newIndex = index;

    if (itemsPerSlide) {
        newIndex += itemsPerSlide * direction;
        newIndex = Math.min(newIndex, items.length - itemsPerSlide);
        newIndex = Math.max(newIndex, 0);
    } else {
        const maxOffset = items[items.length - 1].right - slideWidth;
        const offset = Math.min(items[index].left, maxOffset);
        let item;

        while(item = items[newIndex + direction]) {
            if (Math.abs(item.left - offset) > slideWidth) break;
            newIndex += direction;
        }
    }

    return newIndex;
}

/**
 * Calculates if an item is currently visible.
 *
 * @param {{ left: number, right: number }} item The item to check.
 * @param {number} offset The current offset.
 * @param {number} slideWidth The current container width.
 * @return {boolean}
 */
function isVisible({ left, right }, offset, slideWidth) {
    return (
        left - offset >= 0 &&
        right - offset <= slideWidth
    );
}

/**
 * Calls a function on each element within a parent element.
 *
 * @param {HTMLElement} parent The parent to walk through.
 * @param {(el: HTMLElement, i: number) => any} fn The function to call.
 */
function forEls(parent, fn) {
    let i = 0;
    let child = parent.firstElementChild;
    while (child) {
        fn(child, i++);
        child = child.nextElementSibling;
    }
}

module.exports = require('marko-widgets').defineComponent({
    template,
    getInitialState,
    getTemplateData,
    init,
    onRender,
    onDestroy,
    handleMove,
    handleDotClick,
    getNextIndex
});