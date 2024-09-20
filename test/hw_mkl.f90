program hello
  implicit none
  double precision, dimension(3):: a, b
  double precision:: c
  double precision:: DDOT
  
  a = (/ 3.D0, 3.D0, 3.D0 /)
  b = (/ 1.D0, 1.D0, 1.D0 /)

  c = DDOT(3, a, 1, b, 1)
  
  print *, "hello world", c
end program hello