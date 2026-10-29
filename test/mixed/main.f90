program main
  use iso_c_binding, only: c_int
  implicit none
  interface
    function c_add(a, b) bind(c, name='c_add') result(r)
      import :: c_int
      integer(c_int), value :: a, b
      integer(c_int) :: r
    end function
    function cxx_mul(a, b) bind(c, name='cxx_mul') result(r)
      import :: c_int
      integer(c_int), value :: a, b
      integer(c_int) :: r
    end function
  end interface
  print '(a,i0,a,i0)', 'mixed result ', c_add(2, 3), ' ', cxx_mul(4, 5)
end program
