;(function () {
  function brandTitle() {
    document
      .querySelectorAll(".md-header__topic:first-child .md-ellipsis")
      .forEach(function (el) {
        if (el.querySelector(".lh-brand")) return
        if (el.textContent.trim() !== "LLMHub") return
        el.innerHTML =
          '<span class="lh-brand lh-brand-llm">LLM</span>' +
          '<span class="lh-brand lh-brand-hub">Hub</span>'
      })
  }

  if (typeof document$ !== "undefined") {
    document$.subscribe(brandTitle)
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", brandTitle)
  }
  brandTitle()
})()
