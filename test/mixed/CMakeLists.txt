cmake_minimum_required(VERSION 3.20)
project(mixed C CXX Fortran)
add_executable(mixed main.f90 c_part.c cxx_part.cpp)
