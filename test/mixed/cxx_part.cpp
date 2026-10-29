#include <iostream>

extern "C" int cxx_mul(int a, int b) {
  std::cout << "hello from c++" << std::endl;
  return a * b;
}
