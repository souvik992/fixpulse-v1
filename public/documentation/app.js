(function () {
  if (window.DocsAuth) {
    window.DocsAuth.applyContentOverrides();
  }

  const sidebar = document.getElementById('sidebar');
  const menuButton = document.getElementById('menu-button');
  const searchInput = document.getElementById('doc-search');
  const sections = Array.from(document.querySelectorAll('.doc-section'));
  const navLinks = Array.from(document.querySelectorAll('.nav-link'));

  if (menuButton && sidebar) {
    menuButton.addEventListener('click', function () {
      sidebar.classList.toggle('is-open');
    });
  }

  navLinks.forEach(function (link) {
    link.addEventListener('click', function () {
      if (window.innerWidth <= 1100 && sidebar) sidebar.classList.remove('is-open');
    });
  });

  if (searchInput) {
    searchInput.addEventListener('input', function () {
      const query = searchInput.value.trim().toLowerCase();
      sections.forEach(function (section) {
        const haystack = [
          section.id,
          section.textContent || '',
          section.getAttribute('data-search') || '',
        ].join(' ').toLowerCase();
        const visible = !query || haystack.includes(query);
        section.classList.toggle('is-hidden', !visible);
      });
    });
  }

  const observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      const activeId = '#' + entry.target.id;
      navLinks.forEach(function (link) {
        link.classList.toggle('is-active', link.getAttribute('href') === activeId);
      });
    });
  }, {
    rootMargin: '-20% 0px -60% 0px',
    threshold: 0.1,
  });

  sections.forEach(function (section) {
    observer.observe(section);
  });
})();
