#include <string>
#include <vector>

// extern "C" keeps the symbol callable from Fortran via bind(C), while the
// std::string/std::vector usage inside forces the C++ standard library into
// the link, which is exactly what this companion test verifies.
extern "C" int cxx_word_count(const char *sentence, int length) {
  const std::string text(sentence, static_cast<size_t>(length));
  std::vector<std::string> words;
  size_t start = 0;
  while (start < text.size()) {
    const size_t end = text.find(' ', start);
    if (end == std::string::npos) {
      words.push_back(text.substr(start));
      break;
    }
    if (end > start) {
      words.push_back(text.substr(start, end - start));
    }
    start = end + 1;
  }
  return static_cast<int>(words.size());
}
